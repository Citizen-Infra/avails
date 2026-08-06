// Resolve a group -> its members' DIDs -> their standing-availability records.
//
// Feeds the schedule_call tool (Task 8). Two group kinds, per the availability
// record's own #scope: a Bluesky list, whose membership avails can read from
// the public AppView, and a community-admin community, whose membership avails
// cannot read at all — CA supplies those DIDs instead (my-community#49).
//
// Scope semantics live in scope.js, shared with tools.js: this module decides
// whether a record MATCHES a scope and that module normalizes what a caller
// SENT, and those two answers must never disagree.
//
// Mirrors the resolvePds + listRecords idioms already used in tools.js /
// routes/availability.js — the small fetch helpers are still duplicated here
// on purpose, matching the existing pattern in this codebase.

import { normalizeScope, assertResolvableScope, scopeMatches, parseListUri } from './scope.js';

// Re-exported for existing importers (and its own tests), which knew this file
// as parseListUri's home before scope.js existed.
export { parseListUri };

const AVAILABILITY_COLLECTION = 'chat.avails.scheduling.availability';
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
// scoped to this group and not expired, or null if they have none.
async function resolveMemberRecord(did, scope) {
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
    if (!value || !scopeMatches(value.scope, scope)) return false;
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
// for a specific group scope. Per-DID failures (PDS resolution / listRecords)
// are non-fatal — that DID is skipped, not the whole call. DIDs are deduped.
// The scope is validated up front (see assertResolvableScope).
//
// Takes either scope shape. This is the ONLY path that works for a
// ca-community scope: avails cannot enumerate a community's members, so the
// caller — community-admin, which can — supplies the DIDs.
//
// Shared by resolveListAvailability (the whole list) and schedule_call's
// voter-scoped path (an explicit subset who opted into a proposal) — #103/#119.
export async function resolveAvailabilityForDids(dids, scope) {
  const normalized = normalizeScope(scope);
  assertResolvableScope(normalized);
  const unique = [...new Set(dids)];

  const outcomes = await Promise.allSettled(
    unique.map((did) => resolveMemberRecord(did, normalized))
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
  return resolveAvailabilityForDids(dids, { type: 'atproto-list', value: listUri });
}
