import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateAvailability } from '../lib/availabilityValidate.js';

const router = Router();

const AVAILABILITY_COLLECTION = 'chat.avails.scheduling.availability';

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

// List the caller's availability records straight from their own PDS
// (public read — no auth needed, same as polls.js's resolvePds+listRecords pattern).
async function listAvailabilityRecords(did, pds) {
  const listUrl = `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(AVAILABILITY_COLLECTION)}&limit=100`;
  const listRes = await fetchWithTimeout(listUrl);
  if (!listRes.ok) {
    throw new Error(`Failed to list availability records (${listRes.status})`);
  }
  const data = await listRes.json();
  return data.records || [];
}

// Validation middleware — wraps Task 2's validateAvailability() so this route
// follows the project convention: every write route uses validation middleware
// and reads req.validatedBody (never req.body directly).
function validateAvailabilityBody(req, res, next) {
  const result = validateAvailability(req.body);
  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }
  req.validatedBody = result.value;
  next();
}

// POST / — create-or-replace the caller's standing availability for a scope.
// Writes to the CALLER's own PDS (repo = req.userDid), not a creator's PDS —
// this is the normal authenticated-write case, like polls.js's POST /.
// Enforces one record per scope.value: any prior record for the same
// scope.value is replaced in place (putRecord) instead of creating a duplicate.
router.post('/', requireAuth, validateAvailabilityBody, async (req, res, next) => {
  try {
    const did = req.userDid;
    const pds = await resolvePds(did);

    const existing = await listAvailabilityRecords(did, pds);
    const prior = existing.find((r) => r.value?.scope?.value === req.validatedBody.scope.value);

    const now = new Date().toISOString();
    // The lexicon requires createdAt (validateAvailability doesn't produce it —
    // same division of labor as polls.js, which stamps createdAt in the route).
    const record = {
      $type: AVAILABILITY_COLLECTION,
      ...req.validatedBody,
      createdAt: prior?.value?.createdAt || now,
      ...(prior ? { updatedAt: now } : {}),
    };

    let result;
    if (prior) {
      const rkey = prior.uri.split('/').pop();
      result = await xrpcCall(req.oauthSession, 'com.atproto.repo.putRecord', {
        repo: did,
        collection: AVAILABILITY_COLLECTION,
        rkey,
        record,
        swapRecord: prior.cid,
      });
    } else {
      result = await xrpcCall(req.oauthSession, 'com.atproto.repo.createRecord', {
        repo: did,
        collection: AVAILABILITY_COLLECTION,
        record,
      });
    }

    const rkey = result.uri.split('/').pop();
    res.status(prior ? 200 : 201).json({
      uri: result.uri,
      cid: result.cid,
      rkey,
      did,
      replaced: Boolean(prior),
    });
  } catch (err) {
    next(err);
  }
});

// GET /mine — list the caller's availability records from their own PDS.
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const did = req.userDid;
    const pds = await resolvePds(did);
    const records = await listAvailabilityRecords(did, pds);

    const availability = records
      .map((r) => ({
        uri: r.uri,
        cid: r.cid,
        rkey: r.uri.split('/').pop(),
        did,
        ...r.value,
      }))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json({ records: availability });
  } catch (err) {
    next(err);
  }
});

// DELETE /:rkey — delete one of the caller's own availability records.
// No :did param — the collection always lives in the caller's own PDS, so
// req.userDid is always the repo owner; there's no cross-user delete surface.
router.delete('/:rkey', requireAuth, async (req, res, next) => {
  try {
    const { rkey } = req.params;
    const did = req.userDid;

    await xrpcCall(req.oauthSession, 'com.atproto.repo.deleteRecord', {
      repo: did,
      collection: AVAILABILITY_COLLECTION,
      rkey,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
