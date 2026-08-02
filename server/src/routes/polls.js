import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validatePollCreate, validatePollUpdate, validateGoogleEvent } from '../middleware/validate.js';
import { indexPoll, updatePollStatus, updatePollCommunity, removePoll, listByCommunity } from '../lib/pollIndex.js';
import { generateIcs } from '../lib/ical.js';
import { sendEmail } from '../lib/email.js';
import { composeEmail } from '../lib/email-template.js';
import { deleteOpenMeetEvent } from './openmeet.js';
import { fetchPollResponses } from '../lib/responseReads.js';
import { publishToCommunityFeed } from '../mcp/tools.js';

const router = Router();

const POLL_COLLECTION = 'chat.avails.scheduling.poll';

// Fetch with timeout — prevents hanging on slow PDS responses
function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

// Resolve the PDS endpoint for a DID via the PLC directory
async function resolvePds(did) {
  const res = await fetchWithTimeout(`https://plc.directory/${encodeURIComponent(did)}`);
  if (!res.ok) throw new Error(`Failed to resolve DID ${did}: ${res.status}`);
  const doc = await res.json();
  const svc = doc.service?.find(
    (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
  );
  return svc?.serviceEndpoint || 'https://bsky.social';
}

// Make an authenticated XRPC call using the session's fetchHandler.
// oauthSession.fetchHandler(pathname, init) handles DPoP + token refresh.
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

// POST / — create poll (authenticated)
router.post('/', requireAuth, validatePollCreate, async (req, res, next) => {
  try {
    const record = {
      $type: POLL_COLLECTION,
      ...req.validatedBody,
      createdAt: new Date().toISOString(),
      status: 'open',
    };

    const result = await xrpcCall(req.oauthSession, 'com.atproto.repo.createRecord', {
      repo: req.userDid,
      collection: POLL_COLLECTION,
      record,
    });

    const rkey = result.uri.split('/').pop();

    indexPoll(req.userDid, rkey, {
      title: record.title,
      community: record.community,
      status: 'open',
      responseCount: 0,
      createdAt: record.createdAt,
    });

    res.status(201).json({ uri: result.uri, cid: result.cid, rkey, did: req.userDid });
  } catch (err) {
    next(err);
  }
});

// GET / — list polls for a community from the in-memory index.
// published=1 restricts to polls published to the community feed (#5 sub-project F);
// omitting the param keeps the original behaviour (all matching polls).
router.get('/', (req, res) => {
  const { community, status, published } = req.query;
  if (!community) {
    return res.status(400).json({ error: 'community query param required' });
  }
  const polls = listByCommunity(community, status || 'open', { publishedOnly: published === '1' });
  res.json({ polls });
});

// GET /my — list authenticated user's polls from their PDS
router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const did = req.userDid;
    const pds = await resolvePds(did);

    // Fetch all poll records from the user's PDS
    const listUrl = `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&limit=100`;
    const listRes = await fetchWithTimeout(listUrl);
    if (!listRes.ok) {
      return res.status(listRes.status).json({ error: 'Failed to fetch polls' });
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

    res.json({ polls });
  } catch (err) {
    next(err);
  }
});

// GET /:did/:rkey — read poll + responses from PDS (unauthenticated)
router.get('/:did/:rkey', async (req, res, next) => {
  try {
    const { did, rkey } = req.params;
    const pds = await resolvePds(did);

    // Fetch the poll record
    const pollUrl = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`;
    const pollRes = await fetchWithTimeout(pollUrl);
    if (!pollRes.ok) {
      return res.status(pollRes.status).json({ error: 'Poll not found' });
    }
    const poll = await pollRes.json();

    // Response records: creator repo (legacy) + service repo (new), merged (#42).
    const responses = await fetchPollResponses(did, rkey);

    res.json({ poll: poll.value, uri: poll.uri, cid: poll.cid, responses });
  } catch (err) {
    next(err);
  }
});

// PUT /:did/:rkey — update poll fields (creator only, open polls only)
router.put('/:did/:rkey', requireAuth, validatePollUpdate, async (req, res, next) => {
  try {
    const { did, rkey } = req.params;

    if (req.userDid !== did) {
      return res.status(403).json({ error: 'Only the poll creator can edit' });
    }

    const pds = await resolvePds(did);
    const getUrl = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`;
    const existing = await fetch(getUrl);
    if (!existing.ok) return res.status(404).json({ error: 'Poll not found' });
    const existingData = await existing.json();

    if (existingData.value.finalTime) {
      return res.status(400).json({ error: 'Cannot edit a finalized poll' });
    }

    // Merge validated fields into existing record
    const updatedRecord = {
      ...existingData.value,
      ...req.validatedBody,
    };

    // Remove old field names that aren't in the lexicon schema
    delete updatedRecord.earliestTime;
    delete updatedRecord.latestTime;
    delete updatedRecord.slotDuration;

    await xrpcCall(req.oauthSession, 'com.atproto.repo.putRecord', {
      repo: did,
      collection: POLL_COLLECTION,
      rkey,
      record: updatedRecord,
      swapRecord: existingData.cid,
    });

    // Update in-memory index if title changed
    if (req.validatedBody.title !== undefined) {
      indexPoll(did, rkey, {
        title: updatedRecord.title,
        community: updatedRecord.community,
        status: updatedRecord.status || 'open',
        responseCount: 0,
        createdAt: updatedRecord.createdAt,
      });
    } else if (req.validatedBody.community !== undefined) {
      // Community linked/relinked without a title change — re-point the index
      // (preserving responseCount) so the poll surfaces under the right community.
      updatePollCommunity(did, rkey, updatedRecord.community);
    }

    res.json({ ok: true, poll: updatedRecord });
  } catch (err) {
    next(err);
  }
});

// POST /:did/:rkey/publish-community — publish/unpublish a poll to its
// community's dashboard feed in My Community (#5 sub-project F). Creator-only,
// membership-gated. Delegates to the shared publishToCommunityFeed (also the MCP
// tool) so the web UI and agents run identical logic.
router.post('/:did/:rkey/publish-community', requireAuth, async (req, res, next) => {
  try {
    const { did, rkey } = req.params;
    const result = await publishToCommunityFeed(
      { did, rkey, published: req.body?.published !== false },
      { did: req.userDid, oauthSession: req.oauthSession }
    );
    res.json(JSON.parse(result));
  } catch (err) {
    const msg = err?.message || '';
    if (msg === 'AUTH_REQUIRED') return res.status(401).json({ error: 'Authentication required' });
    if (/Poll not found/i.test(msg)) return res.status(404).json({ error: 'Poll not found' });
    if (/no community set/i.test(msg)) return res.status(400).json({ error: msg });
    if (/creator|not a member|verify your membership/i.test(msg)) return res.status(403).json({ error: msg });
    next(err);
  }
});

// PUT /:did/:rkey/finalize — finalize poll, send .ics emails
router.put('/:did/:rkey/finalize', requireAuth, async (req, res, next) => {
  try {
    const { did, rkey } = req.params;

    if (req.userDid !== did) {
      return res.status(403).json({ error: 'Only the poll creator can finalize' });
    }

    const { finalTime, finalDuration, notifyEmails } = req.body;
    if (!finalTime || !finalDuration) {
      return res.status(400).json({ error: 'finalTime and finalDuration required' });
    }

    // Read existing record to merge fields and get CID for swap
    const pds = await resolvePds(did);
    const getUrl = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`;
    const existing = await fetch(getUrl);
    if (!existing.ok) return res.status(404).json({ error: 'Poll not found' });
    const existingData = await existing.json();

    const updatedRecord = {
      ...existingData.value,
      finalTime,
      finalDuration,
      status: 'finalized',
    };

    await xrpcCall(req.oauthSession, 'com.atproto.repo.putRecord', {
      repo: did,
      collection: POLL_COLLECTION,
      rkey,
      record: updatedRecord,
      swapRecord: existingData.cid,
    });

    updatePollStatus(did, rkey, 'finalized');

    // Fetch responses for participant names and emails (creator + service, #42)
    const pollUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/poll/${did}/${rkey}`;
    const pollResponses = await fetchPollResponses(did, rkey);

    const participants = pollResponses.filter((r) => r.name).map((r) => r.name);
    const icsContent = generateIcs({
      poll: updatedRecord,
      pollUrl,
      did,
      rkey,
      participants,
      method: 'REQUEST',
    });
    const icsBase64 = Buffer.from(icsContent).toString('base64');

    // Collect emails from responses (fallback to notifyEmails from client)
    const responseEmails = pollResponses.filter((r) => r.email).map((r) => r.email);
    const clientEmails = Array.isArray(notifyEmails) ? notifyEmails : [];
    const emailList = [...new Set([...responseEmails, ...clientEmails])];
    if (emailList.length > 0) {
      const whenStr = new Date(updatedRecord.finalTime).toLocaleString('en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: updatedRecord.timezone || 'UTC',
      });
      // Composed once, not per recipient: the body is identical for everyone.
      const composed = composeEmail({
        heading: `${updatedRecord.title} is scheduled`,
        paragraphs: [
          `${whenStr}, for ${updatedRecord.finalDuration} minutes.`,
          updatedRecord.description,
          participants.length > 0 ? `Who answered the poll: ${participants.join(', ')}.` : null,
          'A calendar invite is attached, so this should appear in your calendar automatically.',
        ],
        action: { label: 'View the poll', url: pollUrl },
        footer:
          'You are receiving this because you answered this poll or were added to its notification list. No action is needed.',
      });
      await Promise.allSettled(
        emailList.map((email) =>
          sendEmail({
            to: email,
            subject: `${updatedRecord.title} — time confirmed`,
            ...composed,
            attachments: [
              {
                filename: 'invite.ics',
                content: icsBase64,
              },
            ],
          })
        )
      );
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /:did/:rkey/finalize — unschedule a scheduled poll.
// Clears finalTime + finalDuration + openmeetEventSlug, reverts status to 'open',
// deletes the OpenMeet event if one was published, and sends METHOD:CANCEL .ics
// emails so participants' calendars auto-remove the previously-imported invite.
router.delete('/:did/:rkey/finalize', requireAuth, async (req, res, next) => {
  try {
    const { did, rkey } = req.params;

    if (req.userDid !== did) {
      return res.status(403).json({ error: 'Only the poll creator can unschedule' });
    }

    const pds = await resolvePds(did);
    const getUrl = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`;
    const existing = await fetch(getUrl);
    if (!existing.ok) return res.status(404).json({ error: 'Poll not found' });
    const existingData = await existing.json();
    const existingValue = existingData.value;

    if (!existingValue.finalTime) {
      return res.status(400).json({ error: 'Poll is not scheduled' });
    }

    const openmeetSlug = existingValue.openmeetEventSlug;

    // Snapshot for the cancellation email — needs title + finalTime/Duration pre-clear
    const snapshot = { ...existingValue };

    // Build the new record without the scheduling fields
    const { finalTime: _ft, finalDuration: _fd, openmeetEventSlug: _oes, googleEventId: _gei, googleCalendarId: _gci, ...rest } = existingValue;
    const updatedRecord = { ...rest, status: 'open' };

    await xrpcCall(req.oauthSession, 'com.atproto.repo.putRecord', {
      repo: did,
      collection: POLL_COLLECTION,
      rkey,
      record: updatedRecord,
      swapRecord: existingData.cid,
    });

    updatePollStatus(did, rkey, 'open');

    // Best-effort: delete the OpenMeet event
    let openmeetDeleted = false;
    if (openmeetSlug) {
      openmeetDeleted = await deleteOpenMeetEvent(req.oauthSession, openmeetSlug);
    }

    // Best-effort: send cancellation emails with METHOD:CANCEL .ics
    const pollUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/poll/${did}/${rkey}`;
    const pollResponses = await fetchPollResponses(did, rkey);

    const participants = pollResponses.filter((r) => r.name).map((r) => r.name);
    const emailList = [...new Set(pollResponses.filter((r) => r.email).map((r) => r.email))];

    if (emailList.length > 0) {
      const cancelIcs = generateIcs({
        poll: snapshot,
        pollUrl,
        did,
        rkey,
        participants,
        method: 'CANCEL',
      });
      const icsBase64 = Buffer.from(cancelIcs).toString('base64');

      const whenStr = new Date(snapshot.finalTime).toLocaleString('en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: snapshot.timezone || 'UTC',
      });

      const composed = composeEmail({
        heading: `${snapshot.title} is no longer scheduled`,
        paragraphs: [
          `The time that had been picked, ${whenStr}, is cancelled.`,
          'Your calendar should remove it on its own, since a cancellation is attached.',
          'The poll is open again, so you can change your availability if your options have shifted.',
        ],
        action: { label: 'Update your availability', url: pollUrl },
        footer:
          'You are receiving this because you answered this poll or were added to its notification list.',
      });

      await Promise.allSettled(
        emailList.map((email) =>
          sendEmail({
            to: email,
            subject: `Cancelled: ${snapshot.title}`,
            ...composed,
            attachments: [
              {
                filename: 'cancel.ics',
                content: icsBase64,
              },
            ],
          })
        )
      );
    }

    res.json({
      ok: true,
      openmeetDeleted,
      emailsSent: emailList.length,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /:did/:rkey/google-event — persist the Google Calendar event ID + calendar ID
// on a finalized poll. Called by the client AFTER a successful Google Calendar insert.
// Cleared on unschedule.
router.put('/:did/:rkey/google-event', requireAuth, validateGoogleEvent, async (req, res, next) => {
  try {
    const { did, rkey } = req.params;

    if (req.userDid !== did) {
      return res.status(403).json({ error: 'Only the poll creator can update google-event fields' });
    }

    const { googleEventId, googleCalendarId } = req.validatedBody;

    const pds = await resolvePds(did);
    const getUrl = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`;
    const existing = await fetch(getUrl);
    if (!existing.ok) return res.status(404).json({ error: 'Poll not found' });
    const existingData = await existing.json();
    const existingValue = existingData.value;

    if (!existingValue.finalTime) {
      return res.status(400).json({ error: 'Poll is not scheduled' });
    }

    const updatedRecord = {
      ...existingValue,
      googleEventId,
      googleCalendarId,
    };

    await xrpcCall(req.oauthSession, 'com.atproto.repo.putRecord', {
      repo: did,
      collection: POLL_COLLECTION,
      rkey,
      record: updatedRecord,
      swapRecord: existingData.cid,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /:did/:rkey — delete poll record from PDS
router.delete('/:did/:rkey', requireAuth, async (req, res, next) => {
  try {
    const { did, rkey } = req.params;

    if (req.userDid !== did) {
      return res.status(403).json({ error: 'Only the poll creator can delete' });
    }

    await xrpcCall(req.oauthSession, 'com.atproto.repo.deleteRecord', {
      repo: did,
      collection: POLL_COLLECTION,
      rkey,
    });

    removePoll(did, rkey);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
