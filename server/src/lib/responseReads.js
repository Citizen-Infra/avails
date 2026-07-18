import { isServiceConfigured, getServiceIdentity } from './serviceSession.js';

const RESPONSE_COLLECTION = 'chat.avails.scheduling.response';
const MAX_PAGES = 20; // 20 * 100 = 2000 records; warn if exceeded rather than truncate silently

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

// All responses for a poll, from the creator repo (legacy) + the service repo (new).
export async function fetchPollResponses(creatorDid, rkey) {
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
  return results;
}
