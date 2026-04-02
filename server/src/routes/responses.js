import { Router } from 'express';
import { sessions } from '../lib/sessionStore.js';
import { incrementResponseCount } from '../lib/pollIndex.js';
import { sendEmail } from '../lib/email.js';

const router = Router();

const RESPONSE_COLLECTION = 'chat.avails.scheduling.response';
const POLL_COLLECTION = 'chat.avails.scheduling.poll';

// Find the OAuth session for a given DID by scanning the sessions Map
function findOauthSessionByDid(did) {
  for (const entry of sessions.values()) {
    if (entry.did === did) return entry.oauthSession;
  }
  return null;
}

// Resolve the PDS endpoint for a DID
async function resolvePds(did) {
  const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
  if (!res.ok) throw new Error(`Failed to resolve DID ${did}: ${res.status}`);
  const doc = await res.json();
  const svc = doc.service?.find(
    (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
  );
  return svc?.serviceEndpoint || 'https://bsky.social';
}

// Make an authenticated XRPC call using the session's fetchHandler
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

// POST /api/polls/:did/:rkey/responses — submit availability response
// Anonymous participants write to the CREATOR's PDS using the creator's stored session.
router.post('/:did/:rkey/responses', async (req, res, next) => {
  try {
    const { did, rkey } = req.params;

    // Find creator's OAuth session — required for writing to their PDS
    const creatorSession = findOauthSessionByDid(did);
    if (!creatorSession) {
      return res.status(503).json({
        error: 'Creator is not currently logged in — responses cannot be recorded at this time',
      });
    }

    const pollUri = `at://${did}/${POLL_COLLECTION}/${rkey}`;
    const record = {
      $type: RESPONSE_COLLECTION,
      pollUri,
      ...req.body,
      createdAt: new Date().toISOString(),
    };

    await xrpcCall(creatorSession, 'com.atproto.repo.createRecord', {
      repo: did,
      collection: RESPONSE_COLLECTION,
      record,
    });

    // Increment response count in index and check notifyAfter threshold
    const newCount = incrementResponseCount(did, rkey);

    // Fetch poll to check notifyAfter threshold and creator email
    try {
      const pds = await resolvePds(did);
      const pollUrl = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`;
      const pollRes = await fetch(pollUrl);
      if (pollRes.ok) {
        const pollData = await pollRes.json();
        const poll = pollData.value;
        if (poll.notifyAfter && newCount >= poll.notifyAfter && poll.creatorEmail) {
          const viewUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/poll/${did}/${rkey}`;
          await sendEmail({
            to: poll.creatorEmail,
            subject: `${poll.title} — ${newCount} response${newCount !== 1 ? 's' : ''} received`,
            html: `<p>Your poll <strong>${poll.title}</strong> has reached ${newCount} response${newCount !== 1 ? 's' : ''}.</p><p><a href="${viewUrl}">View responses</a></p>`,
          });
        }
      }
    } catch (notifyErr) {
      // Don't fail the response submission if notification fails
      console.warn('Failed to check/send creator notification:', notifyErr.message);
    }

    res.status(201).json({ ok: true, responseCount: newCount });
  } catch (err) {
    next(err);
  }
});

export default router;
