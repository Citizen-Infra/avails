import { Router } from 'express';
import { sessions } from '../lib/sessionStore.js';
import { getClient } from './auth.js';
import { validateResponseCreate } from '../middleware/validate.js';
import { incrementResponseCount } from '../lib/pollIndex.js';
import { sendEmail } from '../lib/email.js';
import { composeEmail } from '../lib/email-template.js';
import { pollUrl } from '../lib/pollUrl.js';
import {
  isServiceConfigured, serviceCreateRecord, servicePutRecord, serviceDeleteRecord, serviceGetRecord,
} from '../lib/serviceSession.js';

const router = Router();

const RESPONSE_COLLECTION = 'chat.avails.scheduling.response';
const POLL_COLLECTION = 'chat.avails.scheduling.poll';

// Legacy-path 503: only reachable when the service identity is unconfigured (or
// when editing a pre-migration record that lives in the creator's repo) AND the
// creator is signed out. The service path never 503s.
const UNAVAILABLE_MSG = 'This poll is temporarily unavailable. The poll creator needs to sign back in at avails.citizeninfra.org for responses to work. Please try again in a few minutes.';

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

// POST /api/polls/:did/:rkey/responses — submit availability response.
// New responses are written to avails' own service repo (#42) so they no longer
// depend on the creator being signed in. When the service identity is
// unconfigured, fall back to the legacy creator-PDS write.
router.post('/:did/:rkey/responses', validateResponseCreate, async (req, res, next) => {
  try {
    const { did, rkey } = req.params;

    const pollUri = `at://${did}/${POLL_COLLECTION}/${rkey}`;
    const record = {
      $type: RESPONSE_COLLECTION,
      pollUri,
      ...req.validatedBody,
      createdAt: new Date().toISOString(),
    };

    let createdResponseRkey = null;
    if (isServiceConfigured()) {
      const createResult = await serviceCreateRecord(RESPONSE_COLLECTION, record);
      createdResponseRkey = createResult?.uri?.split('/').pop() || null;
    } else {
      const creatorSession = await findOauthSessionByDid(did);
      if (!creatorSession) return res.status(503).json({ error: UNAVAILABLE_MSG });
      const createResult = await xrpcCall(creatorSession, 'com.atproto.repo.createRecord', {
        repo: did,
        collection: RESPONSE_COLLECTION,
        record,
      });
      createdResponseRkey = createResult?.uri?.split('/').pop() || null;
    }

    // Increment response count in index and check notifyAfter threshold
    const newCount = incrementResponseCount(did, rkey);

    // Fetch poll to check notifyAfter threshold and creator email
    try {
      const pds = await resolvePds(did);
      // recordUrl, not pollUrl: this is the PDS getRecord endpoint, not the
      // poll's page on the web. Naming it pollUrl would shadow the imported
      // helper in this scope and turn the call below into a TypeError.
      const recordUrl = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`;
      const pollRes = await fetchWithTimeout(recordUrl);
      if (pollRes.ok) {
        const pollData = await pollRes.json();
        const poll = pollData.value;
        if (poll.notifyAfter && newCount >= poll.notifyAfter && poll.creatorEmail) {
          const viewUrl = pollUrl(did, rkey);
          const plural = (n) => (n !== 1 ? 's' : '');
          await sendEmail({
            to: poll.creatorEmail,
            subject: `${poll.title} — ${newCount} response${plural(newCount)} received`,
            ...composeEmail({
              heading: `${poll.title} has ${newCount} response${plural(newCount)}`,
              paragraphs: [
                `You asked to hear once this poll reached ${poll.notifyAfter} response${plural(poll.notifyAfter)}. It is at ${newCount}.`,
                'You can pick a time now, or leave the poll open and wait for more people to answer.',
              ],
              action: { label: 'See who is available', url: viewUrl },
              footer:
                'You are receiving this because you created this poll and asked to be notified at a response count.',
            }),
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

// PUT /api/polls/:did/:rkey/responses/:responseRkey — update an existing response.
// A record created since #42 lives in the service repo; a pre-migration record
// lives in the creator's repo. Disambiguate with a service getRecord, then route
// the write to the repo that actually holds it.
router.put('/:did/:rkey/responses/:responseRkey', validateResponseCreate, async (req, res, next) => {
  try {
    const { did, rkey, responseRkey } = req.params;

    const pollUri = `at://${did}/${POLL_COLLECTION}/${rkey}`;
    const record = {
      $type: RESPONSE_COLLECTION,
      pollUri,
      ...req.validatedBody,
      createdAt: new Date().toISOString(),
    };

    if (isServiceConfigured() && await serviceGetRecord(RESPONSE_COLLECTION, responseRkey)) {
      await servicePutRecord(RESPONSE_COLLECTION, responseRkey, record);
    } else {
      const creatorSession = await findOauthSessionByDid(did);
      if (!creatorSession) return res.status(503).json({ error: UNAVAILABLE_MSG });
      await xrpcCall(creatorSession, 'com.atproto.repo.putRecord', {
        repo: did,
        collection: RESPONSE_COLLECTION,
        rkey: responseRkey,
        record,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /:did/:rkey/responses/:responseRkey — delete a response. Same service-vs
// -legacy disambiguation as PUT.
router.delete('/:did/:rkey/responses/:responseRkey', async (req, res, next) => {
  try {
    const { did, responseRkey } = req.params;

    if (isServiceConfigured() && await serviceGetRecord(RESPONSE_COLLECTION, responseRkey)) {
      await serviceDeleteRecord(RESPONSE_COLLECTION, responseRkey);
    } else {
      const creatorSession = await findOauthSessionByDid(did);
      if (!creatorSession) return res.status(503).json({ error: UNAVAILABLE_MSG });
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
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
