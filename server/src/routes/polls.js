import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { indexPoll, updatePollStatus, removePoll, listByCommunity } from '../lib/pollIndex.js';
import { generateIcs } from '../lib/ical.js';
import { sendEmail } from '../lib/email.js';
import { sessions } from '../lib/sessionStore.js';

const router = Router();

const POLL_COLLECTION = 'chat.avails.scheduling.poll';
const RESPONSE_COLLECTION = 'chat.avails.scheduling.response';

// Resolve the PDS endpoint for a DID via the PLC directory
async function resolvePds(did) {
  const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
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
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const record = {
      $type: POLL_COLLECTION,
      ...req.body,
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

    res.status(201).json({ uri: result.uri, cid: result.cid, rkey });
  } catch (err) {
    next(err);
  }
});

// GET / — list polls for a community from the in-memory index
router.get('/', (req, res) => {
  const { community, status } = req.query;
  if (!community) {
    return res.status(400).json({ error: 'community query param required' });
  }
  const polls = listByCommunity(community, status || 'open');
  res.json({ polls });
});

// GET /:did/:rkey — read poll + responses from PDS (unauthenticated)
router.get('/:did/:rkey', async (req, res, next) => {
  try {
    const { did, rkey } = req.params;
    const pds = await resolvePds(did);

    // Fetch the poll record
    const pollUrl = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`;
    const pollRes = await fetch(pollUrl);
    if (!pollRes.ok) {
      return res.status(pollRes.status).json({ error: 'Poll not found' });
    }
    const poll = await pollRes.json();

    // Fetch response records stored in the creator's PDS
    const responsesUrl = `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(RESPONSE_COLLECTION)}&limit=100`;
    const responsesRes = await fetch(responsesUrl);
    let responses = [];
    if (responsesRes.ok) {
      const data = await responsesRes.json();
      // Filter to only responses belonging to this poll
      responses = (data.records || []).filter(
        (r) => r.value?.pollUri && r.value.pollUri.includes(`/${rkey}`)
      );
    }

    res.json({ poll: poll.value, uri: poll.uri, cid: poll.cid, responses });
  } catch (err) {
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

    // Generate .ics and send email invites to all participants who provided an email
    const pollUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/poll/${did}/${rkey}`;
    const icsContent = generateIcs(updatedRecord, pollUrl);
    const icsBase64 = Buffer.from(icsContent).toString('base64');

    const emailList = Array.isArray(notifyEmails) ? notifyEmails : [];
    if (emailList.length > 0) {
      await Promise.allSettled(
        emailList.map((email) =>
          sendEmail({
            to: email,
            subject: `${updatedRecord.title} — time confirmed`,
            html: `<p>The poll <strong>${updatedRecord.title}</strong> has been finalized.</p><p><a href="${pollUrl}">View poll</a></p><p>A calendar invite is attached.</p>`,
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
