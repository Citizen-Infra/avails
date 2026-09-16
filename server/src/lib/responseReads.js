import { isServiceConfigured, getServiceIdentity } from './serviceSession.js';

const RESPONSE_COLLECTION = 'chat.avails.scheduling.response';
const MAX_PAGES = 20; // 20 * 100 = 2000 records; warn if exceeded rather than truncate silently
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

function timeToMinutes(value, { allowEndOfDay = false } = {}) {
  const match = typeof value === 'string' ? TIME_RE.exec(value) : null;
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 24 || (hours === 24 && (!allowEndOfDay || minutes !== 0))) {
    return null;
  }
  return hours * 60 + minutes;
}

/**
 * Build the exact creator-timezone slot keys represented by a poll's current
 * dates, time range, and interval. Legacy field names remain readable because
 * old poll records still use them.
 */
export function currentPollSlots(poll) {
  const valid = new Set();
  if (!poll || !Array.isArray(poll.dates)) return valid;

  const range = poll.timeRange || (
    poll.earliestTime && poll.latestTime
      ? { start: poll.earliestTime, end: poll.latestTime }
      : null
  );
  const slotMinutes = Number(poll.slotMinutes ?? poll.slotDuration ?? 30);
  const start = timeToMinutes(range?.start);
  const end = timeToMinutes(range?.end, { allowEndOfDay: true });

  if (
    start === null || end === null || start >= end ||
    !Number.isInteger(slotMinutes) || slotMinutes <= 0 || slotMinutes > 1440
  ) {
    return valid;
  }

  for (const date of poll.dates) {
    if (typeof date !== 'string' || !DATE_RE.test(date)) continue;
    for (let minute = start; minute < end; minute += slotMinutes) {
      const hours = String(Math.floor(minute / 60)).padStart(2, '0');
      const minutes = String(minute % 60).padStart(2, '0');
      valid.add(`${date}T${hours}:${minutes}`);
    }
  }

  return valid;
}

/**
 * Keep response metadata intact while constraining every response to slots the
 * current poll can actually render. Stored records remain untouched so edits do
 * not rewrite participant data or require write access to legacy repositories.
 */
export function sanitizePollResponses(responses, poll) {
  const validSlots = currentPollSlots(poll);
  return (Array.isArray(responses) ? responses : []).map((response) => ({
    ...response,
    slots: Array.isArray(response?.slots)
      ? response.slots.filter((slot) => validSlots.has(slot))
      : [],
  }));
}

async function resolvePds(did) {
  const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
  if (!res.ok) throw new Error(`resolve PDS ${did}: ${res.status}`);
  const doc = await res.json();
  const svc = doc.service?.find((s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
  return svc?.serviceEndpoint || 'https://bsky.social';
}

// Page listRecords on `repo`@`pds` for the response collection, keeping records
// whose pollUri belongs to `rkey`. Public/unauthenticated.
async function pagedResponses(pds, repo, rkey, home) {
  const out = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(repo)}&collection=${encodeURIComponent(RESPONSE_COLLECTION)}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) break;                       // a down repo yields no rows, never throws a read
    const data = await res.json();
    for (const r of data.records || []) {
      if (r.value?.pollUri && r.value.pollUri.endsWith(`/${rkey}`)) {
        out.push({ ...r.value, uri: r.uri, cid: r.cid, home });
      }
    }
    cursor = data.cursor;
    if (!cursor) return out;
  }
  console.warn(`[responseReads] hit MAX_PAGES for ${repo} poll ${rkey} — response list may be truncated`);
  return out;
}

// All responses for a poll, from the creator repo (legacy) + the service repo
// (new), constrained to the poll's current slot definition.
export async function fetchPollResponses(creatorDid, rkey, poll) {
  const results = [];
  try {
    const creatorPds = await resolvePds(creatorDid);
    results.push(...await pagedResponses(creatorPds, creatorDid, rkey, 'creator'));
  } catch (err) {
    console.warn(`[responseReads] creator repo read failed for ${creatorDid}:`, err.message);
  }
  if (isServiceConfigured()) {
    try {
      const { did, pds } = await getServiceIdentity();
      results.push(...await pagedResponses(pds, did, rkey, 'service'));
    } catch (err) {
      console.warn('[responseReads] service repo read failed:', err.message);
    }
  }
  return sanitizePollResponses(results, poll);
}
