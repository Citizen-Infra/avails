import { Router } from 'express';
import { createHash } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { validateAvailability } from '../lib/availabilityValidate.js';
import { scopeMatches } from '../mcp/scope.js';
import { assertEventAvailabilityGrant, EventGrantError } from '../lib/eventGrant.js';

const router = Router();

const AVAILABILITY_COLLECTION = 'chat.avails.scheduling.availability';

// One record per scope, enforced structurally rather than by checking first.
//
// The rkey is derived from the scope, so re-publishing the same scope is a
// putRecord to the same key — an overwrite. The previous list-then-create was
// not atomic: two concurrent POSTs could both observe "no prior" and both
// createRecord, leaving the user with two public records for one scope. There
// is no cross-record transaction in ATProto to fix that with, but a
// deterministic key removes the need for one — the duplicate becomes
// unrepresentable instead of merely unlikely.
//
// 24 hex chars (96 bits) is far inside the rkey charset ([A-Za-z0-9.-_~],
// 1-512) and collision-safe at this scale.
export function rkeyForScope(scope) {
  return createHash('sha256').update(`${scope.type}\n${scope.value}`).digest('hex').slice(0, 24);
}

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
    const scope = req.validatedBody.scope;
    if (scope.type === 'ca-event') {
      try {
        await assertEventAvailabilityGrant(scope.value, did);
      } catch (err) {
        if (err instanceof EventGrantError) {
          return res.status(err.status).json({
            error: err.message,
            ...(err.reason && { reason: err.reason }),
            ...(err.retryable && { retryable: true }),
          });
        }
        throw err;
      }
    }

    const pds = await resolvePds(did);
    const rkey = rkeyForScope(scope);

    const existing = await listAvailabilityRecords(did, pds);
    // Both halves, matching scope.js: rkeyForScope hashes type AND value, so a
    // value-only filter here would sweep a same-value record of the OTHER type
    // as though it were a stale duplicate of this one — deleting a real record
    // for a different group.
    const sameScope = existing.filter((r) => scopeMatches(r.value?.scope, scope));
    const prior = sameScope.find((r) => r.uri.split('/').pop() === rkey);
    // Records written before the deterministic scheme carry a TID rkey, as can
    // a duplicate the old non-atomic path produced. Either would linger as a
    // second public record for this scope, so they're swept below.
    const stale = sameScope.filter((r) => r.uri.split('/').pop() !== rkey);

    const now = new Date().toISOString();
    // The lexicon requires createdAt (validateAvailability doesn't produce it —
    // same division of labor as polls.js, which stamps createdAt in the route).
    // Carry it across a legacy record too, so migrating a key doesn't reset the
    // user's original publish date.
    const priorCreatedAt = prior?.value?.createdAt || stale[0]?.value?.createdAt;
    const record = {
      $type: AVAILABILITY_COLLECTION,
      ...req.validatedBody,
      createdAt: priorCreatedAt || now,
      ...(priorCreatedAt ? { updatedAt: now } : {}),
    };

    const result = await xrpcCall(req.oauthSession, 'com.atproto.repo.putRecord', {
      repo: did,
      collection: AVAILABILITY_COLLECTION,
      rkey,
      record,
      // CAS only when overwriting the deterministic key, so a concurrent edit
      // fails loudly rather than silently losing the other write.
      ...(prior ? { swapRecord: prior.cid } : {}),
    });

    // Best-effort, and deliberately after the write: the new record landing is
    // the outcome that matters, so a failed cleanup must not fail the publish
    // or roll it back (same reasoning as the Google Calendar path in polls.js).
    // The caller is told what's left over rather than it failing silently.
    let staleRemaining = 0;
    for (const r of stale) {
      try {
        await xrpcCall(req.oauthSession, 'com.atproto.repo.deleteRecord', {
          repo: did,
          collection: AVAILABILITY_COLLECTION,
          rkey: r.uri.split('/').pop(),
        });
      } catch (e) {
        staleRemaining += 1;
        console.error(`[availability] Failed to sweep stale record ${r.uri}:`, e.message);
      }
    }

    res.status(priorCreatedAt ? 200 : 201).json({
      uri: result.uri,
      cid: result.cid,
      rkey,
      did,
      replaced: Boolean(priorCreatedAt),
      ...(staleRemaining > 0 && { staleRemaining }),
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

// Participant-facing status for an event-scoped editor. This remains an online
// CA decision; the browser never receives the service credential.
router.get('/event-grant/:eventDid', requireAuth, async (req, res, next) => {
  try {
    const decision = await assertEventAvailabilityGrant(req.params.eventDid, req.userDid);
    res.json({ active: true, reason: decision.reason });
  } catch (err) {
    if (err instanceof EventGrantError) {
      if (err.status === 403) return res.json({ active: false, reason: err.reason });
      return res.status(err.status).json({ error: err.message, retryable: err.retryable });
    }
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
