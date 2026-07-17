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
// Helpers (mirrors patterns from tools.js)
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

// Validates `at://<did>/app.bsky.graph.list/<rkey>` shape. Throws otherwise.
function assertListUri(listUri) {
  if (typeof listUri !== 'string' || !listUri.startsWith('at://')) {
    throw new Error(`Invalid list URI: ${listUri}`);
  }
  const segments = listUri.slice('at://'.length).split('/');
  const [did, collection, rkey] = segments;
  if (!did || collection !== LIST_COLLECTION || !rkey) {
    throw new Error(`Not an ${LIST_COLLECTION} URI: ${listUri}`);
  }
}

// Pages app.bsky.graph.getList on the public AppView until the cursor is
// exhausted, returning every member's DID.
async function fetchListMemberDids(listUri) {
  const dids = [];
  let cursor;
  do {
    const params = new URLSearchParams({ list: listUri, limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`${BSKY_APPVIEW}/xrpc/app.bsky.graph.getList?${params.toString()}`);
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

  const res = await fetch(
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

// Resolves a Bluesky list to the standing-availability records its members
// have published for that list. Per-member failures (PDS resolution or
// listRecords) are non-fatal — that member is skipped, not the whole call.
export async function resolveListAvailability(listUri) {
  assertListUri(listUri);

  const memberDids = await fetchListMemberDids(listUri);

  const outcomes = await Promise.allSettled(
    memberDids.map((did) => resolveMemberRecord(did, listUri))
  );

  const results = [];
  outcomes.forEach((outcome, i) => {
    const did = memberDids[i];
    if (outcome.status === 'fulfilled') {
      if (outcome.value) results.push({ did, record: outcome.value });
    } else {
      console.error(`[listMembers] Skipping ${did} (availability lookup failed):`, outcome.reason?.message || outcome.reason);
    }
  });

  return results;
}
