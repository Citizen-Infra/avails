// Resolve a Bluesky list -> its members -> their standing-availability records.
//
// Feeds the schedule_call tool (Task 8): given a list URI, page the public
// AppView for member DIDs, then pull each member's standing-availability
// record scoped to that list from their own PDS.
//
// Mirrors the resolvePds + listRecords idioms already used in tools.js /
// routes/availability.js — this file is not wired into those (no shared
// helper module exists yet), so the small helpers are duplicated here on
// purpose, matching the existing pattern in this codebase.

const AVAILABILITY_COLLECTION = 'chat.avails.scheduling.availability';
const LIST_COLLECTION = 'app.bsky.graph.list';
const BSKY_APPVIEW = 'https://public.api.bsky.app';

// ---------------------------------------------------------------------------
// Helpers (mirrors patterns from tools.js / routes/availability.js)
// ---------------------------------------------------------------------------

// Fetch with timeout — a hanging member PDS (a plausible ATProto federation
// failure, distinct from an outright error) must not block the whole group
// resolution. Mirrors the helper in routes/availability.js:10-14. A timeout
// rejects like any other fetch failure, so it flows through the existing
// per-member Promise.allSettled skip path below.
function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function resolvePds(did) {
  const res = await fetchWithTimeout(`https://plc.directory/${encodeURIComponent(did)}`);
  if (!res.ok) throw new Error(`Failed to resolve DID ${did}: ${res.status}`);
  const doc = await res.json();
  const svc = doc.service?.find(
    (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
  );
  return svc?.serviceEndpoint || 'https://bsky.social';
}

// Validates `at://<did>/app.bsky.graph.list/<rkey>` shape and returns the
// authority DID, which is the list's owner — a record can only live in its
// own creator's repo, so this holds without trusting any API response shape.
// Throws otherwise.
export function parseListUri(listUri) {
  if (typeof listUri !== 'string' || !listUri.startsWith('at://')) {
    throw new Error(`Invalid list URI: ${listUri}`);
  }
  const segments = listUri.slice('at://'.length).split('/');
  const [did, collection, rkey] = segments;
  if (!did || collection !== LIST_COLLECTION || !rkey) {
    throw new Error(`Not an ${LIST_COLLECTION} URI: ${listUri}`);
  }
  return did;
}

// Pages app.bsky.graph.getList on the public AppView until the cursor is
// exhausted, returning every member's DID.
async function fetchListMemberDids(listUri) {
  const dids = [];
  let cursor;
  do {
    const params = new URLSearchParams({ list: listUri, limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetchWithTimeout(`${BSKY_APPVIEW}/xrpc/app.bsky.graph.getList?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch list ${listUri}: ${res.status}`);
    }
    const data = await res.json();
    for (const item of data.items || []) {
      const memberDid = item?.subject?.did;
      if (memberDid) dids.push(memberDid);
    }
    cursor = data.cursor || undefined;
  } while (cursor);
  return dids;
}

// Fetches one member's availability records and returns the latest one
// scoped to this list and not expired, or null if they have none.
async function resolveMemberRecord(did, listUri) {
  const pds = await resolvePds(did);

  const res = await fetchWithTimeout(
    `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(AVAILABILITY_COLLECTION)}&limit=100`
  );
  if (!res.ok) {
    throw new Error(`Failed to list availability records for ${did}: ${res.status}`);
  }
  const data = await res.json();

  const now = Date.now();
  const matching = (data.records || []).filter((record) => {
    const value = record?.value;
    if (!value || value.scope?.value !== listUri) return false;
    if (value.validUntil && new Date(value.validUntil).getTime() <= now) return false;
    return true;
  });

  if (matching.length === 0) return null;

  matching.sort((a, b) => {
    const aTime = new Date(a.value.updatedAt || a.value.createdAt || 0).getTime();
    const bTime = new Date(b.value.updatedAt || b.value.createdAt || 0).getTime();
    return bTime - aTime;
  });

  return matching[0];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Resolves the standing-availability records a given set of DIDs have published
// for a specific list scope. Per-DID failures (PDS resolution / listRecords) are
// non-fatal — that DID is skipped, not the whole call. DIDs are deduped. The
// list URI is validated up front so a malformed scope throws loudly rather than
// resolving to an empty set (which would masquerade as thin coverage).
//
// Shared by resolveListAvailability (the whole list) and schedule_call's
// voter-scoped path (an explicit subset who opted into a proposal) — #103/#119.
export async function resolveAvailabilityForDids(dids, listUri) {
  parseListUri(listUri); // throws on a malformed at:// list URI
  const unique = [...new Set(dids)];

  const outcomes = await Promise.allSettled(
    unique.map((did) => resolveMemberRecord(did, listUri))
  );

  const results = [];
  outcomes.forEach((outcome, i) => {
    const did = unique[i];
    if (outcome.status === 'fulfilled') {
      if (outcome.value) results.push({ did, record: outcome.value });
    } else {
      console.error(`[listMembers] Skipping ${did} (availability lookup failed):`, outcome.reason?.message || outcome.reason);
    }
  });

  return results;
}

// Resolves a Bluesky list to the standing-availability records its members have
// published for that list. Includes the list OWNER, whom getList omits from
// items and whom Bluesky's UI won't let self-add — so without this the curator
// of a group's list could never be scheduled through it (#110). Safe because
// opt-in is the record's scope, not list membership: an owner who published no
// record for this list is filtered out and contributes nothing.
export async function resolveListAvailability(listUri) {
  const ownerDid = parseListUri(listUri);
  const dids = [ownerDid, ...(await fetchListMemberDids(listUri))];
  return resolveAvailabilityForDids(dids, listUri);
}
