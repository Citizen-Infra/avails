import { indexPoll, updatePollStatus, listByCommunity } from '../lib/pollIndex.js';
import { generateIcs } from '../lib/ical.js';
import { sendEmail } from '../lib/email.js';
import { getOpenMeetToken } from '../routes/openmeet.js';
import { computeBestSlots } from './overlap.js';
import { sendTelegramMessage } from './telegram.js';

const POLL_COLLECTION = 'chat.avails.scheduling.poll';
const RESPONSE_COLLECTION = 'chat.avails.scheduling.response';

// ---------------------------------------------------------------------------
// Helpers (mirrors patterns from routes/polls.js)
// ---------------------------------------------------------------------------

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

const SCENIUS_GROUPS_API = 'https://scenius-digest.vercel.app/api/groups';

// scenius-digest gates group_id + output_channel (Telegram chat IDs) behind a
// read-only Bearer token. We need those IDs to post polls via the Avails bot,
// so send SCENIUS_CONFIG_SECRET when present. See scenius-digest#13.
async function fetchCommunityGroups() {
  const secret = process.env.SCENIUS_CONFIG_SECRET;
  const headers = secret ? { Authorization: `Bearer ${secret}` } : {};
  const res = await fetch(SCENIUS_GROUPS_API, { headers });
  if (!res.ok) throw new Error(`Failed to fetch community config: ${res.status}`);
  const data = await res.json();
  return data.groups || data;
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
    name: 'list_communities',
    description:
      'List available communities with their Telegram topics. Use this to discover topic names before calling share_poll.',
    inputSchema: {
      type: 'object',
      properties: {},
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
    const icsContent = generateIcs(updatedRecord, url, participants);
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
  const auth = requireAuth(authContext);
  if (auth.did !== did) throw new Error('Only the poll creator can publish to OpenMeet');
  if (!auth.oauthSession) throw new Error('OAuth session not found. Please re-authenticate.');

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
    case 'list_communities':
      return listCommunities();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
