import { indexPoll, updatePollStatus, updatePollPublished, listByCommunity } from '../lib/pollIndex.js';
import { generateIcs } from '../lib/ical.js';
import { sendEmail } from '../lib/email.js';
import { getOpenMeetToken } from '../routes/openmeet.js';
import { computeBestSlots } from './overlap.js';
import { sendTelegramMessage } from './telegram.js';
import { assertMembership } from '../lib/membership.js';
import { resolveListAvailability, resolveAvailabilityForDids } from './listMembers.js';
import { bestCallSlots } from './availabilityOverlap.js';

const POLL_COLLECTION = 'chat.avails.scheduling.poll';
const RESPONSE_COLLECTION = 'chat.avails.scheduling.response';

// Coverage floor for schedule_call's no-poll auto-booking (#103 Phase 1):
// below this many members with standing-availability records, or below
// this many free at the chosen top slot, booking is skipped in favour of
// signalling a create_poll fallback instead.
const MIN_CALL_COVERAGE = 2;

// ---------------------------------------------------------------------------
// Helpers (mirrors patterns from routes/polls.js)
// ---------------------------------------------------------------------------

// Minimal HTML-escape for caller-controlled strings (e.g. poll/call titles)
// interpolated into email HTML bodies. Mirrors the escapeHtml in lib/og.js
// (not exported from there, so duplicated locally rather than reaching into
// an unrelated module for a 6-line helper).
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function resolvePds(did) {
  const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
  if (!res.ok) throw new Error(`Failed to resolve DID ${did}: ${res.status}`);
  const doc = await res.json();
  const svc = doc.service?.find(
    (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
  );
  return svc?.serviceEndpoint || 'https://bsky.social';
}

async function xrpcCall(oauthSession, method, body) {
  const pathname = `/xrpc/${method}`;
  const response = await oauthSession.fetchHandler(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`XRPC ${method} failed (${response.status}): ${text}`);
  }
  return response.json();
}

function pollUrl(did, rkey) {
  const base = process.env.CLIENT_URL || 'http://localhost:5173';
  return `${base}/p/${did}/${rkey}`;
}

// community-admin is the source of truth for community config (IdP S2) — it
// emits active communities with a Telegram group_id + output_channel + topics.
// We read it directly from /api/config (Bearer CA_CONFIG_SECRET), reusing the
// same community-admin base as the S4 membership gate. scenius-digest is no
// longer in this path (it was a temporary middleman, unrelated to scheduling).
async function fetchCommunityGroups() {
  const base = process.env.CA_MEMBERSHIP_URL?.replace(/\/$/, '');
  const secret = process.env.CA_CONFIG_SECRET;
  if (!base || !secret) {
    throw new Error('Community config is not configured (CA_MEMBERSHIP_URL / CA_CONFIG_SECRET).');
  }
  const res = await fetch(`${base}/api/config`, { headers: { Authorization: `Bearer ${secret}` } });
  if (!res.ok) throw new Error(`Failed to fetch community config: ${res.status}`);
  const data = await res.json();
  return data.communities || {};
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    name: 'get_poll',
    description:
      'Fetch a poll and all its responses from the creator\'s ATProto PDS. Returns poll metadata, responses, best overlapping slots, and the poll URL.',
    inputSchema: {
      type: 'object',
      properties: {
        did: {
          type: 'string',
          description: 'DID of the poll creator (e.g. did:plc:abc123)',
        },
        rkey: {
          type: 'string',
          description: 'Record key of the poll',
        },
      },
      required: ['did', 'rkey'],
    },
  },
  {
    name: 'list_polls',
    description:
      'List polls indexed for a community. Returns polls sorted by creation date.',
    inputSchema: {
      type: 'object',
      properties: {
        community: {
          type: 'string',
          description: 'Community slug (e.g. "scenius", "cibc")',
        },
        status: {
          type: 'string',
          enum: ['open', 'finalized'],
          description: 'Filter by status. Defaults to "open".',
        },
      },
      required: [],
    },
  },
  {
    name: 'create_poll',
    description:
      'Create a new availability poll stored in the authenticated user\'s ATProto PDS.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Poll title',
        },
        dates: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of date strings (YYYY-MM-DD)',
        },
        timeRange: {
          type: 'object',
          properties: {
            start: { type: 'string', description: 'Start time HH:MM' },
            end: { type: 'string', description: 'End time HH:MM' },
          },
          required: ['start', 'end'],
          description: 'Time range for availability slots',
        },
        slotMinutes: {
          type: 'number',
          description: 'Slot duration in minutes (e.g. 30, 60)',
        },
        timezone: {
          type: 'string',
          description: 'IANA timezone (e.g. "America/New_York")',
        },
        description: {
          type: 'string',
          description: 'Optional poll description',
        },
        community: {
          type: 'string',
          description: 'Optional community slug for indexing',
        },
        notifyAfter: {
          type: 'number',
          description: 'Optional: send notification after this many responses',
        },
        notifyEmail: {
          type: 'string',
          description: 'Optional: email address for notifications',
        },
        hideResponsesUntilSubmit: {
          type: 'boolean',
          description: 'Optional: if true, respondents see no other responses on the grid until they submit their own',
        },
      },
      required: ['title', 'dates', 'timeRange', 'slotMinutes', 'timezone'],
    },
  },
  {
    name: 'list_my_polls',
    description:
      'List all polls created by the authenticated user, fetched directly from their ATProto PDS.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'update_poll',
    description:
      'Update fields on an existing open poll. Only the poll creator can call this. Omit any field to leave it unchanged. Cannot be used on finalized polls.',
    inputSchema: {
      type: 'object',
      properties: {
        rkey: {
          type: 'string',
          description: 'Record key of the poll to update',
        },
        title: {
          type: 'string',
          description: 'New poll title',
        },
        description: {
          type: 'string',
          description: 'New poll description',
        },
        dates: {
          type: 'array',
          items: { type: 'string' },
          description: 'New array of date strings (YYYY-MM-DD)',
        },
        timeRange: {
          type: 'object',
          properties: {
            start: { type: 'string', description: 'Start time HH:MM' },
            end: { type: 'string', description: 'End time HH:MM' },
          },
          required: ['start', 'end'],
          description: 'New time range for availability slots',
        },
        slotMinutes: {
          type: 'number',
          description: 'New slot duration in minutes (15, 30, or 60)',
        },
        hideResponsesUntilSubmit: {
          type: 'boolean',
          description: 'If true, respondents see no other responses on the grid until they submit their own',
        },
      },
      required: ['rkey'],
    },
  },
  {
    name: 'schedule',
    description:
      'Finalize a poll by setting the meeting time. Only the poll creator can call this. Sends calendar invite emails to participants who provided an email address.',
    inputSchema: {
      type: 'object',
      properties: {
        did: {
          type: 'string',
          description: 'DID of the poll creator',
        },
        rkey: {
          type: 'string',
          description: 'Record key of the poll',
        },
        finalTime: {
          type: 'string',
          description: 'ISO 8601 datetime for the scheduled meeting',
        },
        finalDuration: {
          type: 'number',
          description: 'Meeting duration in minutes',
        },
      },
      required: ['did', 'rkey', 'finalTime', 'finalDuration'],
    },
  },
  {
    name: 'share_poll',
    description:
      'Share a poll to a community\'s Telegram channel or group topic. Use named topics (e.g. "events", "links") when possible — the response includes available topic names for the community. Always confirm with the user before sharing.',
    inputSchema: {
      type: 'object',
      properties: {
        did: {
          type: 'string',
          description: 'DID of the poll creator',
        },
        rkey: {
          type: 'string',
          description: 'Record key of the poll',
        },
        community: {
          type: 'string',
          description: 'Community slug (e.g. "scenius", "cibc")',
        },
        topic: {
          type: 'string',
          description: 'Topic name (e.g. "events", "links", "news") or numeric thread ID. Omit to post to the output channel. Prefer named topics over numeric IDs.',
        },
        message: {
          type: 'string',
          description: 'Optional custom message to include with the share',
        },
      },
      required: ['did', 'rkey', 'community'],
    },
  },
  {
    name: 'publish_to_openmeet',
    description:
      'Publish a finalized poll as an OpenMeet event. The poll must be scheduled (have finalTime set). Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        did: {
          type: 'string',
          description: 'DID of the poll creator',
        },
        rkey: {
          type: 'string',
          description: 'Record key of the poll',
        },
      },
      required: ['did', 'rkey'],
    },
  },
  {
    name: 'publish_to_community_feed',
    description:
      "Publish (or unpublish) a poll to its community's dashboard feed in My Community. Creator-only; requires membership of the poll's community. Pass published:false to unpublish.",
    inputSchema: {
      type: 'object',
      properties: {
        did: { type: 'string', description: 'DID of the poll creator' },
        rkey: { type: 'string', description: 'Record key of the poll' },
        published: { type: 'boolean', description: 'false to unpublish; defaults to true (publish)' },
      },
      required: ['did', 'rkey'],
    },
  },
  {
    name: 'list_communities',
    description:
      'List available communities with their Telegram topics. Use this to discover topic names before calling share_poll.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'schedule_call',
    description:
      'Book a call directly from a group\'s standing availability — no poll. Resolves the members\' standing-availability records for the given scope, finds the best overlapping slot in the requested window, and books it if coverage is sufficient (at least 2 members with records, and at least 2 free at the chosen slot). Members whose record has trust:auto are auto-booked; trust:confirm members are returned separately and are NOT silently committed. If coverage is too thin, returns a fallback signal instead of booking — it does not create a poll itself. Only atproto-list scopes are supported (ca-community scopes are Phase 3 and are rejected). Pass voterDids to book for a specific subset (the people who voted/liked) rather than the whole list.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          description:
            'Scope to resolve standing availability from. Either an at://<did>/app.bsky.graph.list/<rkey> list URI string (Phase 1 shorthand), or an explicit { type, value } object. type "ca-community" is Phase 3 and will be rejected.',
          oneOf: [
            {
              type: 'string',
              description: 'A list URI: at://<did>/app.bsky.graph.list/<rkey>',
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['atproto-list', 'ca-community'] },
                value: { type: 'string' },
              },
              required: ['type', 'value'],
            },
          ],
        },
        durationMinutes: {
          type: 'number',
          description: 'Call duration in minutes (e.g. 30, 60)',
        },
        window: {
          type: 'object',
          properties: {
            start: { type: 'string', description: 'Window start date (YYYY-MM-DD)' },
            end: { type: 'string', description: 'Window end date (YYYY-MM-DD)' },
          },
          required: ['start', 'end'],
          description: 'Inclusive date window to search for a call slot.',
        },
        title: {
          type: 'string',
          description: 'Call title, used for the calendar invite and confirmation emails.',
        },
        voterDids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. When present, book only for these DIDs (the people who opted into this specific proposal — e.g. the likers of a Bluesky post), instead of the whole list. Their records are still matched to `scope`; a DID that published no availability for this list is a coverage miss. Omit to schedule for the entire list.',
        },
      },
      required: ['scope', 'durationMinutes', 'window', 'title'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function getPoll({ did, rkey }) {
  const pds = await resolvePds(did);

  const pollRes = await fetch(
    `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`
  );
  if (!pollRes.ok) {
    throw new Error(`Poll not found: ${pollRes.status}`);
  }
  const poll = await pollRes.json();

  const responsesRes = await fetch(
    `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(RESPONSE_COLLECTION)}&limit=100`
  );
  let responses = [];
  if (responsesRes.ok) {
    const data = await responsesRes.json();
    responses = (data.records || [])
      .filter((r) => r.value?.pollUri && r.value.pollUri.includes(`/${rkey}`))
      .map((r) => ({ ...r.value, uri: r.uri, cid: r.cid }));
  }

  const bestSlots = computeBestSlots(responses);

  return JSON.stringify({
    poll: poll.value,
    uri: poll.uri,
    cid: poll.cid,
    responses,
    bestSlots,
    url: pollUrl(did, rkey),
  });
}

async function listPolls({ community, status }) {
  const polls = listByCommunity(community || '', status || 'open');
  return JSON.stringify({ polls });
}

async function createPoll(args, authContext) {
  if (!authContext) throw new Error('AUTH_REQUIRED');
  if (!authContext.oauthSession) throw new Error('AUTH_REQUIRED');

  const { title, dates, timeRange, slotMinutes, timezone, description, community, notifyAfter, notifyEmail, hideResponsesUntilSubmit } = args;

  const record = {
    $type: POLL_COLLECTION,
    title,
    dates,
    timeRange,
    slotMinutes,
    timezone,
    ...(description !== undefined && { description }),
    ...(community !== undefined && { community }),
    ...(notifyAfter !== undefined && { notifyAfter }),
    ...(notifyEmail !== undefined && { notifyEmail }),
    ...(hideResponsesUntilSubmit === true && { hideResponsesUntilSubmit: true }),
    createdAt: new Date().toISOString(),
    status: 'open',
  };

  const result = await xrpcCall(authContext.oauthSession, 'com.atproto.repo.createRecord', {
    repo: authContext.did,
    collection: POLL_COLLECTION,
    record,
  });

  const rkey = result.uri.split('/').pop();

  indexPoll(authContext.did, rkey, {
    title: record.title,
    community: record.community,
    status: 'open',
    responseCount: 0,
    createdAt: record.createdAt,
  });

  return JSON.stringify({
    uri: result.uri,
    cid: result.cid,
    rkey,
    did: authContext.did,
    url: pollUrl(authContext.did, rkey),
  });
}

async function updatePoll(args, authContext) {
  if (!authContext) throw new Error('AUTH_REQUIRED');
  if (!authContext.oauthSession) throw new Error('AUTH_REQUIRED');

  const { rkey, title, description, dates, timeRange, slotMinutes, hideResponsesUntilSubmit } = args;
  if (!rkey) throw new Error('rkey is required');

  const did = authContext.did;
  const pds = await resolvePds(did);

  const getRes = await fetch(
    `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`
  );
  if (!getRes.ok) throw new Error(`Poll not found: ${getRes.status}`);
  const existingData = await getRes.json();

  if (existingData.value.finalTime) {
    throw new Error('Cannot edit a finalized poll');
  }

  const updatedRecord = {
    ...existingData.value,
    ...(title !== undefined && { title: title.trim() }),
    ...(description !== undefined && { description: description.trim() }),
    ...(dates !== undefined && { dates }),
    ...(timeRange !== undefined && { timeRange }),
    ...(slotMinutes !== undefined && { slotMinutes }),
    ...(hideResponsesUntilSubmit !== undefined && { hideResponsesUntilSubmit }),
  };

  // Remove old field names that aren't in the lexicon schema
  delete updatedRecord.earliestTime;
  delete updatedRecord.latestTime;
  delete updatedRecord.slotDuration;

  await xrpcCall(authContext.oauthSession, 'com.atproto.repo.putRecord', {
    repo: did,
    collection: POLL_COLLECTION,
    rkey,
    record: updatedRecord,
    swapRecord: existingData.cid,
  });

  if (title !== undefined) {
    indexPoll(did, rkey, {
      title: updatedRecord.title,
      community: updatedRecord.community,
      status: updatedRecord.status || 'open',
      responseCount: 0,
      createdAt: updatedRecord.createdAt,
    });
  }

  return JSON.stringify({ ok: true, poll: updatedRecord, url: pollUrl(did, rkey) });
}

async function listMyPolls(_args, authContext) {
  if (!authContext) throw new Error('AUTH_REQUIRED');

  const did = authContext.did;
  const pds = await resolvePds(did);

  const listRes = await fetch(
    `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&limit=100`
  );
  if (!listRes.ok) {
    throw new Error(`Failed to fetch polls: ${listRes.status}`);
  }
  const data = await listRes.json();

  const polls = (data.records || [])
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      rkey: r.uri.split('/').pop(),
      did,
      ...r.value,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return JSON.stringify({ polls });
}

async function schedule({ did, rkey, finalTime, finalDuration }, authContext) {
  if (!authContext) throw new Error('AUTH_REQUIRED');
  if (!authContext.oauthSession) throw new Error('AUTH_REQUIRED');

  if (authContext.did !== did) {
    throw new Error('Only the poll creator can finalize a poll');
  }

  const pds = await resolvePds(did);

  // Read existing record to merge and get CID for swap
  const getRes = await fetch(
    `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`
  );
  if (!getRes.ok) throw new Error(`Poll not found: ${getRes.status}`);
  const existingData = await getRes.json();

  const updatedRecord = {
    ...existingData.value,
    finalTime,
    finalDuration,
    status: 'finalized',
  };

  await xrpcCall(authContext.oauthSession, 'com.atproto.repo.putRecord', {
    repo: did,
    collection: POLL_COLLECTION,
    rkey,
    record: updatedRecord,
    swapRecord: existingData.cid,
  });

  updatePollStatus(did, rkey, 'finalized');

  // Fetch all responses to find participant emails
  const responsesRes = await fetch(
    `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(RESPONSE_COLLECTION)}&limit=100`
  );
  let emailsSent = 0;
  if (responsesRes.ok) {
    const data = await responsesRes.json();
    const responses = (data.records || [])
      .filter((r) => r.value?.pollUri && r.value.pollUri.includes(`/${rkey}`))
      .map((r) => r.value);

    const url = pollUrl(did, rkey);
    const participants = responses.filter((r) => r.name).map((r) => r.name);
    const icsContent = generateIcs({ poll: updatedRecord, pollUrl: url, did, rkey, participants });
    const icsBase64 = Buffer.from(icsContent).toString('base64');

    const emailAddresses = responses
      .filter((r) => r.email && typeof r.email === 'string')
      .map((r) => r.email);

    // Deduplicate
    const uniqueEmails = [...new Set(emailAddresses)];

    if (uniqueEmails.length > 0) {
      const results = await Promise.allSettled(
        uniqueEmails.map((email) =>
          sendEmail({
            to: email,
            subject: `${updatedRecord.title} — time confirmed`,
            html: `<p><strong>${updatedRecord.title}</strong> has been scheduled.</p>${updatedRecord.description ? `<p>${updatedRecord.description}</p>` : ''}<p><strong>When:</strong> ${new Date(updatedRecord.finalTime).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: updatedRecord.timezone || 'UTC' })} (${updatedRecord.finalDuration} min)</p>${participants.length > 0 ? `<p><strong>Participants:</strong> ${participants.join(', ')}</p>` : ''}<p><a href="${url}">View poll</a></p><p>A calendar invite is attached.</p>`,
            attachments: [
              {
                filename: 'invite.ics',
                content: icsBase64,
              },
            ],
          })
        )
      );
      emailsSent = results.filter((r) => r.status === 'fulfilled').length;
    }
  }

  return JSON.stringify({
    scheduled: true,
    finalTime,
    finalDuration,
    emailsSent,
    url: pollUrl(did, rkey),
  });
}

async function sharePoll({ did, rkey, community, topic, message }, authContext) {
  if (!authContext) throw new Error('AUTH_REQUIRED');

  // S4: only a verified member of the target community may broadcast to its
  // channel. Fails closed. authContext.did was cryptographically verified by
  // avails' own ATProto OAuth. Runs before any PDS/config/Telegram work so a
  // non-member learns nothing about the poll or the community.
  await assertMembership(authContext.did, community);

  // Fetch poll details from PDS
  const pds = await resolvePds(did);
  const pollRes = await fetch(
    `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`
  );
  if (!pollRes.ok) throw new Error(`Poll not found: ${pollRes.status}`);
  const pollData = await pollRes.json();
  const poll = pollData.value;

  // Fetch community config from scenius-digest API (authenticated: includes chat IDs)
  const groups = await fetchCommunityGroups();

  const communityConfig = groups[community];
  if (!communityConfig) {
    throw new Error(`Unknown community: ${community}. Available: ${Object.keys(groups).join(', ')}`);
  }

  // Determine target: group topic or output channel
  let chatId;
  let messageThreadId;
  let targetName;

  if (topic) {
    // Post to a specific topic in the community's source group
    chatId = communityConfig.group_id;
    if (!chatId) {
      throw new Error(`Community "${community}" has no group_id configured`);
    }

    if (communityConfig.topics && communityConfig.topics[topic]) {
      // Named topic from config
      messageThreadId = communityConfig.topics[topic];
      targetName = `${communityConfig.name || community} #${topic}`;
    } else if (/^\d+$/.test(topic)) {
      // Numeric thread ID passed directly
      messageThreadId = topic;
      targetName = `${communityConfig.name || community} thread:${topic}`;
    } else {
      const available = communityConfig.topics ? Object.keys(communityConfig.topics).join(', ') : 'none';
      throw new Error(`Topic "${topic}" not found in ${community}. Available: ${available}. You can also pass a numeric thread ID directly.`);
    }
  } else {
    // Post to the output channel
    chatId = communityConfig.output_channel;
    if (!chatId) {
      throw new Error(`Community "${community}" has no output_channel configured`);
    }
    targetName = communityConfig.name || community;
  }

  // Format message
  const url = pollUrl(did, rkey);

  const dateList = Array.isArray(poll.dates)
    ? poll.dates.map(d => {
        const date = new Date(d + 'T12:00:00'); // noon to avoid timezone shift
        const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
        const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${weekday} ${monthDay}`;
      }).join(', ')
    : 'dates TBD';

  const tz = poll.timezone || '';
  const timeRange =
    poll.timeRange
      ? `${poll.timeRange.start}–${poll.timeRange.end}${tz ? ` ${tz}` : ''}`
      : poll.earliestTime && poll.latestTime
      ? `${poll.earliestTime}–${poll.latestTime}${tz ? ` ${tz}` : ''}`
      : '';

  let text = `📅 ${poll.title}\n`;
  if (dateList) text += `${dateList}\n`;
  if (timeRange) text += `${timeRange}\n`;
  if (message) text += `\n${message}\n`;
  text += `\n${url}`;

  const result = await sendTelegramMessage(chatId, text, { messageThreadId });

  const availableTopics = communityConfig.topics
    ? Object.keys(communityConfig.topics)
    : [];

  return JSON.stringify({
    shared: true,
    target: targetName,
    messageId: result.result?.message_id,
    url,
    availableTopics,
  });
}

async function publishToOpenmeet({ did, rkey }, authContext) {
  if (!authContext) throw new Error('AUTH_REQUIRED');
  if (!authContext.oauthSession) throw new Error('AUTH_REQUIRED');
  const auth = authContext;
  if (auth.did !== did) throw new Error('Only the poll creator can publish to OpenMeet');

  // Fetch poll from PDS
  const pds = await resolvePds(did);
  const pollRes = await fetch(
    `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`
  );
  if (!pollRes.ok) throw new Error(`Poll not found: ${pollRes.status}`);
  const pollData = await pollRes.json();
  const poll = pollData.value;

  if (!poll.finalTime) {
    throw new Error('Poll must be scheduled (have finalTime) before publishing to OpenMeet');
  }

  // Get OpenMeet token via ATProto service auth
  const tokenResult = await getOpenMeetToken(auth.oauthSession);
  if (tokenResult.error === 'scope-missing') {
    throw new Error('Your Bluesky session is missing the OpenMeet permission. Sign out and sign back in via the Avails web UI to grant it.');
  }
  if (!tokenResult.token) {
    throw new Error('Could not authenticate with OpenMeet. Do you have an OpenMeet account linked to your Bluesky?');
  }
  const token = tokenResult.token;

  const url = pollUrl(did, rkey);
  const OPENMEET_API = process.env.OPENMEET_API_URL || 'https://api.openmeet.net';

  const endDate = poll.finalDuration
    ? new Date(new Date(poll.finalTime).getTime() + poll.finalDuration * 60 * 1000).toISOString()
    : new Date(new Date(poll.finalTime).getTime() + 60 * 60 * 1000).toISOString();

  const eventPayload = {
    name: poll.title,
    description: poll.description
      ? `${poll.description}\n\nScheduled via Avails: ${url}`
      : `Scheduled via Avails: ${url}`,
    startDate: poll.finalTime,
    endDate,
    type: 'online',
    status: 'published',
    visibility: 'public',
    timeZone: poll.timezone || 'UTC',
    maxAttendees: 0,
    categories: [],
    location: 'Online (scheduled via Avails)',
    locationOnline: url,
    source: {
      type: 'bluesky',
      id: auth.did,
      url,
      handle: auth.handle,
    },
  };

  const response = await fetch(`${OPENMEET_API}/api/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-tenant-id': process.env.OPENMEET_TENANT_ID || 'lsdfaopkljdfs',
    },
    body: JSON.stringify(eventPayload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenMeet API error: ${response.status} ${text}`);
  }

  const result = await response.json();
  const eventUrl = result.slug
    ? `https://platform.openmeet.net/events/${result.slug}`
    : undefined;

  // Persist slug on the poll record so unscheduling can delete the OpenMeet
  // event later. Best-effort — if the PUT fails the publish still succeeded.
  if (result.slug) {
    try {
      await auth.oauthSession.fetchHandler('/xrpc/com.atproto.repo.putRecord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: did,
          collection: POLL_COLLECTION,
          rkey,
          record: { ...poll, openmeetEventSlug: result.slug },
          swapRecord: pollData.cid,
        }),
      });
    } catch (err) {
      console.log('[openmeet-mcp] Failed to persist slug (non-fatal):', err.message);
    }
  }

  return JSON.stringify({
    published: true,
    eventId: result.id,
    eventUrl,
    title: poll.title,
    startDate: poll.finalTime,
    endDate,
  }, null, 2);
}

// Publish (published !== false) or unpublish (published === false) a poll to
// its community's dashboard feed in My Community (#5 sub-project F). Creator-only,
// gated on the poll's community membership (the same assertMembership gate as
// share_poll, fails closed). The PDS record's communityFeedPublishedAt is the
// source of truth (openmeetEventSlug convention: presence = published); the
// in-memory index mirror is what the public list endpoint filters on, so it is
// updated only AFTER the authoritative record write succeeds. Shared by the MCP
// tool and the HTTP route (POST /api/polls/:did/:rkey/publish-community).
export async function publishToCommunityFeed({ did, rkey, published }, authContext) {
  if (!authContext) throw new Error('AUTH_REQUIRED');
  if (!authContext.oauthSession) throw new Error('AUTH_REQUIRED');
  if (authContext.did !== did) {
    throw new Error('Only the poll creator can publish it to the community feed');
  }

  const pds = await resolvePds(did);
  const getRes = await fetch(
    `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`
  );
  if (!getRes.ok) throw new Error(`Poll not found: ${getRes.status}`);
  const existing = await getRes.json();
  const community = existing.value?.community;
  if (!community) {
    throw new Error('This poll has no community set, so it cannot be published to a community feed.');
  }

  await assertMembership(authContext.did, community);

  const publishedAt = published === false ? null : new Date().toISOString();
  const updatedRecord = { ...existing.value };
  if (publishedAt) updatedRecord.communityFeedPublishedAt = publishedAt;
  else delete updatedRecord.communityFeedPublishedAt;

  await xrpcCall(authContext.oauthSession, 'com.atproto.repo.putRecord', {
    repo: did,
    collection: POLL_COLLECTION,
    rkey,
    record: updatedRecord,
    swapRecord: existing.cid,
  });

  updatePollPublished(did, rkey, publishedAt);

  return JSON.stringify({ ok: true, published: publishedAt !== null, publishedAt, url: pollUrl(did, rkey) });
}

async function listCommunities() {
  const groups = await fetchCommunityGroups();

  const communities = Object.entries(groups).map(([key, cfg]) => ({
    key,
    name: cfg.name || key,
    topics: cfg.topics ? Object.keys(cfg.topics) : [],
    hasOutputChannel: !!cfg.output_channel,
  }));

  return JSON.stringify(communities, null, 2);
}

// Accepts either a bare list-URI string or an explicit { type, value } scope
// object (mirrors the availability record's own #scope shape — see
// lexicons/chat/avails/scheduling/availability.json). Does not itself
// validate that `value` is a well-formed at:// URI — resolveListAvailability
// does that for the atproto-list path.
const SCOPE_TYPES = ['atproto-list', 'ca-community'];

function normalizeScope(scope) {
  // A bare string is unambiguous shorthand — there is only one kind of URI a
  // caller can pass — so it still defaults.
  if (typeof scope === 'string') {
    return { type: 'atproto-list', value: scope };
  }
  if (scope && typeof scope === 'object' && typeof scope.value === 'string') {
    // An object that names no type is a caller bug, not shorthand: defaulting
    // it silently sent a mistyped ca-community scope down the list path, where
    // it failed later with an unrelated error about the URI shape.
    if (scope.type === undefined) {
      throw new Error(`scope.type is required when scope is an object: one of ${SCOPE_TYPES.join(', ')}`);
    }
    if (!SCOPE_TYPES.includes(scope.type)) {
      throw new Error(`Unknown scope.type "${scope.type}": expected one of ${SCOPE_TYPES.join(', ')}`);
    }
    return { type: scope.type, value: scope.value };
  }
  throw new Error(
    'scope is required: either an at://<did>/app.bsky.graph.list/<rkey> URI string, or { type, value }'
  );
}

// Minimal at:// URI parse, duplicated locally rather than imported from
// listMembers.js — matches the existing pattern in this codebase of small
// per-file helpers (see listMembers.js's own header comment) since there is
// no shared helper module yet. Only used after resolveListAvailability has
// already validated the URI, so no error handling needed here.
function parseAtUri(uri) {
  const [did, , rkey] = uri.slice('at://'.length).split('/');
  return { did, rkey };
}

// schedule_call (#103, Task 8, Phase 1): books a call straight from a
// group's standing availability — no poll. Reading availability records is
// public (no auth), so this tool does not require authContext.
async function scheduleCall({ scope, durationMinutes, window, title, voterDids }) {
  const normalizedScope = normalizeScope(scope);

  if (normalizedScope.type === 'ca-community') {
    throw new Error(
      'ca-community scope is not supported in Phase 1. Use an atproto-list scope (a list URI) instead — ca-community scoping is Phase 3.'
    );
  }
  if (normalizedScope.type !== 'atproto-list') {
    throw new Error(`Unsupported scope type "${normalizedScope.type}". Phase 1 only supports "atproto-list".`);
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error('durationMinutes must be a positive integer');
  }
  if (!window || !window.start || !window.end) {
    throw new Error('window ({start, end}) is required');
  }
  if (!title) {
    throw new Error('title is required');
  }

  // Optional voter-scoped booking (#103/#119): when the caller supplies an
  // explicit set of DIDs (the people who opted into a proposal), book for that
  // subset instead of the whole list. avails does not interpret HOW they voted
  // (a Bluesky like, an MC vote, a Telegram reaction) — it receives DIDs. Their
  // records are still matched to `scope`, so a voter who published nothing for
  // this list is a coverage miss, exactly as an absent list member would be.
  if (voterDids !== undefined) {
    if (!Array.isArray(voterDids) || !voterDids.every((d) => typeof d === 'string' && d.startsWith('did:'))) {
      throw new Error('voterDids must be an array of DID strings');
    }
    if (voterDids.length === 0) {
      throw new Error('voterDids, when provided, must be non-empty');
    }
  }

  const members = voterDids
    ? await resolveAvailabilityForDids(voterDids, normalizedScope.value)
    : await resolveListAvailability(normalizedScope.value);
  const withRecords = members.length;

  // Coverage floor #1: not enough members have published availability at
  // all — skip the (pointless) overlap computation and signal the fallback
  // directly.
  if (withRecords < MIN_CALL_COVERAGE) {
    return JSON.stringify({
      booked: false,
      fallback: 'create_poll',
      reason: `Only ${withRecords} member${withRecords === 1 ? '' : 's'} of the group ${withRecords === 1 ? 'has' : 'have'} standing availability on record (need at least ${MIN_CALL_COVERAGE}).`,
    });
  }

  const slots = bestCallSlots({ members, window, durationMinutes });

  // Coverage floor #2: no overlapping slot exists at all in the window.
  if (slots.length === 0) {
    return JSON.stringify({
      booked: false,
      fallback: 'create_poll',
      reason: `No overlapping availability found between ${window.start} and ${window.end} for a ${durationMinutes}-minute call.`,
    });
  }

  const top = slots[0];

  // Coverage floor #3: best overlap still isn't enough people.
  if (top.count < MIN_CALL_COVERAGE) {
    return JSON.stringify({
      booked: false,
      fallback: 'create_poll',
      reason: `Best overlap is only ${top.count} member${top.count === 1 ? '' : 's'} free (at ${top.slot}); need at least ${MIN_CALL_COVERAGE}.`,
    });
  }

  // Trust split at the chosen slot: support (does it clear the floor?) and
  // trust (who gets auto-booked vs asked) are independent — the slot books
  // regardless of the mix, per #103. Any trust value other than exactly
  // 'auto' (including unrecognized/missing) is treated as needing
  // confirmation — never silently committed.
  const byDid = new Map(members.map((m) => [m.did, m]));
  const autoBooked = [];
  const needsConfirm = [];
  for (const did of top.participants) {
    const trust = byDid.get(did)?.record?.value?.trust;
    if (trust === 'auto') {
      autoBooked.push(did);
    } else {
      needsConfirm.push(did);
    }
  }

  // Build a synthetic poll-shaped record for generateIcs. There is no poll
  // record in this flow (that's the point), so did/rkey for the ICS UID are
  // derived from the list owner + chosen slot instead — stable and unique
  // per (list, slot), not tied to any created record.
  const { did: listOwnerDid, rkey: listRkey } = parseAtUri(normalizedScope.value);
  const icsRkey = `call-${listRkey}-${top.slot.replace(/[^0-9]/g, '')}`;
  const finalTime = `${top.slot}:00Z`;
  const url = process.env.CLIENT_URL || 'http://localhost:5173';

  const icsContent = generateIcs({
    poll: { title, finalTime, finalDuration: durationMinutes },
    pollUrl: url,
    did: listOwnerDid,
    rkey: icsRkey,
    participants: [...autoBooked, ...needsConfirm],
    method: 'REQUEST',
  });
  const icsBase64 = Buffer.from(icsContent).toString('base64');

  // Best-effort email: standing-availability records don't carry an email
  // field in the lexicon today, so this will usually send to nobody — but
  // if a record does carry one, notify it, and never fail the booking on
  // an email error.
  const emailTargets = top.participants
    .map((did) => byDid.get(did))
    .filter((m) => m?.record?.value?.email);

  if (emailTargets.length > 0) {
    const safeTitle = escapeHtml(title);
    await Promise.allSettled(
      emailTargets.map((m) =>
        sendEmail({
          to: m.record.value.email,
          subject: `${title} — call scheduled`,
          html: `<p><strong>${safeTitle}</strong> has been scheduled.</p><p><strong>When:</strong> ${new Date(finalTime).toUTCString()} (${durationMinutes} min)</p><p>A calendar invite is attached.</p>`,
          attachments: [{ filename: 'invite.ics', content: icsBase64 }],
        })
      )
    );
  }

  return JSON.stringify({
    booked: true,
    slot: top.slot,
    durationMinutes,
    title,
    participants: top.participants,
    autoBooked,
    needsConfirm,
    coverage: {
      withRecords,
      membersFree: top.count,
      // When voter-scoped, let the caller see how many of the people who voted
      // actually had a usable record — so CA can message "3 of 5 voters haven't
      // published availability" rather than guessing.
      ...(voterDids ? { voters: voterDids.length, votersWithoutRecords: voterDids.length - withRecords } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listTools() {
  return TOOL_DEFINITIONS;
}

export async function callTool(name, args, authContext) {
  switch (name) {
    case 'get_poll':
      return getPoll(args);
    case 'list_polls':
      return listPolls(args);
    case 'create_poll':
      return createPoll(args, authContext);
    case 'update_poll':
      return updatePoll(args, authContext);
    case 'list_my_polls':
      return listMyPolls(args, authContext);
    case 'schedule':
      return schedule(args, authContext);
    case 'share_poll':
      return sharePoll(args, authContext);
    case 'publish_to_openmeet':
      return publishToOpenmeet(args, authContext);
    case 'publish_to_community_feed':
      return publishToCommunityFeed(args, authContext);
    case 'list_communities':
      return listCommunities();
    case 'schedule_call':
      return scheduleCall(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
