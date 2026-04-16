import { Router } from 'express';
import { sessions } from '../lib/sessionStore.js';
import { getClient } from './auth.js';
import { validateResponseCreate } from '../middleware/validate.js';
import { incrementResponseCount } from '../lib/pollIndex.js';
import { sendEmail } from '../lib/email.js';

const router = Router();

const RESPONSE_COLLECTION = 'chat.avails.scheduling.response';
const POLL_COLLECTION = 'chat.avails.scheduling.poll';

// Fetch with timeout — prevents hanging on slow PDS responses
function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

// Find the OAuth session for a given DID by scanning the sessions Map.
// If the session exists but the live oauthSession is null (failed restore on startup),
// attempt a lazy restore on the spot.
async function findOauthSessionByDid(did) {
  for (const entry of sessions.values()) {
    if (entry.did === did) {
      if (entry.oauthSession) return entry.oauthSession;
      // Session exists but oauthSession is null — try lazy restore
      try {
        const client = await getClient();
        const oauthSession = await client.restore(did);
        entry.oauthSession = oauthSession;
        console.log(`Lazy-restored OAuth session for ${did}`);
        return oauthSession;
      } catch (err) {
        console.warn(`Lazy restore failed for ${did}:`, err.message);
        return null;
      }
    }
  }
  return null;
}

// Resolve the PDS endpoint for a DID
async function resolvePds(did) {
  const res = await fetchWithTimeout(`https://plc.directory/${encodeURIComponent(did)}`);
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
router.post('/:did/:rkey/responses', validateResponseCreate, async (req, res, next) => {
  try {
    const { did, rkey } = req.params;

    // Find creator's OAuth session — required for writing to their PDS
    const creatorSession = await findOauthSessionByDid(did);
    if (!creatorSession) {
      return res.status(503).json({
        error: 'This poll is temporarily unavailable. The poll creator needs to sign back in at avails.zhgnv.com for responses to work. Please try again in a few minutes.',
      });
    }

    const pollUri = `at://${did}/${POLL_COLLECTION}/${rkey}`;
    const record = {
      $type: RESPONSE_COLLECTION,
      pollUri,
      ...req.validatedBody,
      createdAt: new Date().toISOString(),
    };

    const createResult = await xrpcCall(creatorSession, 'com.atproto.repo.createRecord', {
      repo: did,
      collection: RESPONSE_COLLECTION,
      record,
    });

    // Extract the rkey of the newly created response record
    // AT URI format: at://did/collection/rkey
    const createdResponseRkey = createResult?.uri?.split('/').pop() || null;

    // Increment response count in index and check notifyAfter threshold
    const newCount = incrementResponseCount(did, rkey);

    // Fetch poll to check notifyAfter threshold and creator email
    try {
      const pds = await resolvePds(did);
      const pollUrl = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`;
      const pollRes = await fetchWithTimeout(pollUrl);
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

    res.status(201).json({ ok: true, responseCount: newCount, responseRkey: createdResponseRkey });
  } catch (err) {
    next(err);
  }
});

// PUT /api/polls/:did/:rkey/responses/:responseRkey — update an existing response
router.put('/:did/:rkey/responses/:responseRkey', validateResponseCreate, async (req, res, next) => {
  try {
    const { did, rkey, responseRkey } = req.params;

    const creatorSession = await findOauthSessionByDid(did);
    if (!creatorSession) {
      return res.status(503).json({
        error: 'This poll is temporarily unavailable. The poll creator needs to sign back in at avails.zhgnv.com for responses to work. Please try again in a few minutes.',
      });
    }

    const pollUri = `at://${did}/${POLL_COLLECTION}/${rkey}`;
    const record = {
      $type: RESPONSE_COLLECTION,
      pollUri,
      ...req.validatedBody,
      createdAt: new Date().toISOString(),
    };

    await xrpcCall(creatorSession, 'com.atproto.repo.putRecord', {
      repo: did,
      collection: RESPONSE_COLLECTION,
      rkey: responseRkey,
      record,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /:did/:rkey/responses/:responseRkey — delete a response
router.delete('/:did/:rkey/responses/:responseRkey', async (req, res, next) => {
  try {
    const { did, responseRkey } = req.params;

    const creatorSession = await findOauthSessionByDid(did);
    if (!creatorSession) {
      return res.status(503).json({ error: 'This poll is temporarily unavailable. The poll creator needs to sign back in at avails.zhgnv.com for responses to work. Please try again in a few minutes.' });
    }

    const deleteResult = await creatorSession.fetchHandler(
      `/xrpc/com.atproto.repo.deleteRecord`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: did,
          collection: RESPONSE_COLLECTION,
          rkey: responseRkey,
        }),
      }
    );

    if (!deleteResult.ok) {
      const text = await deleteResult.text();
      throw new Error(`Failed to delete response: ${deleteResult.status} ${text}`);
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
