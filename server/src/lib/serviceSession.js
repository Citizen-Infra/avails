// avails' own ATProto identity. Writes poll responses to avails' own repo so a
// response no longer depends on the creator's OAuth session (#42). App-password
// auth (createSession/refreshSession) — NOT OAuth; this is a headless service
// credential, not a user grant. Feature-flagged: when the env vars are absent,
// callers fall back to the legacy creator-session path.

const IDENTIFIER = () => process.env.AVAILS_SERVICE_IDENTIFIER;
const APP_PASSWORD = () => process.env.AVAILS_SERVICE_APP_PASSWORD;
const CONFIGURED_PDS = () => process.env.AVAILS_SERVICE_PDS; // optional override

export function isServiceConfigured() {
  return Boolean(IDENTIFIER() && APP_PASSWORD());
}

let identity = null;   // { did, pds }
let tokens = null;     // { accessJwt, refreshJwt }

async function resolvePdsForDid(did) {
  const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
  if (!res.ok) throw new Error(`resolve PDS for ${did}: ${res.status}`);
  const doc = await res.json();
  const svc = doc.service?.find((s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
  return svc?.serviceEndpoint || 'https://bsky.social';
}

// The host we call createSession against IS the account's PDS. Prefer an explicit
// AVAILS_SERVICE_PDS; else default to bsky.social for login, then trust the DID's
// resolved PDS for reads/writes.
function loginHost() {
  return CONFIGURED_PDS() || 'https://bsky.social';
}

async function login() {
  if (!isServiceConfigured()) throw new Error('service identity not configured');
  const res = await fetch(`${loginHost()}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: IDENTIFIER(), password: APP_PASSWORD() }),
  });
  if (!res.ok) throw new Error(`service login failed: ${res.status} ${await res.text().catch(() => '')}`);
  const data = await res.json();
  tokens = { accessJwt: data.accessJwt, refreshJwt: data.refreshJwt };
  identity = { did: data.did, pds: CONFIGURED_PDS() || (await resolvePdsForDid(data.did)) };
  return identity;
}

export async function getServiceIdentity() {
  if (identity) return identity;
  return login();
}

async function refresh() {
  const res = await fetch(`${loginHost()}/xrpc/com.atproto.server.refreshSession`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.refreshJwt}` },
  });
  if (!res.ok) { await login(); return; }        // refresh dead → full re-login
  const data = await res.json();
  tokens = { accessJwt: data.accessJwt, refreshJwt: data.refreshJwt };
}

// Authenticated XRPC POST against the service PDS, refreshing+retrying once on an
// expired/invalid token.
async function authedXrpc(method, body, { retry = true } = {}) {
  const id = await getServiceIdentity();
  if (!tokens) await login();
  const doCall = () => fetch(`${id.pds}/xrpc/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.accessJwt}` },
    body: JSON.stringify(body),
  });
  let res = await doCall();
  if (!res.ok && retry) {
    const text = await res.text().catch(() => '');
    if (res.status === 400 || res.status === 401) {
      if (/ExpiredToken|InvalidToken|AuthenticationRequired/i.test(text)) {
        await refresh();
        res = await doCall();
      } else {
        throw new Error(`${method} failed (${res.status}): ${text}`);
      }
    } else {
      throw new Error(`${method} failed (${res.status}): ${text}`);
    }
  }
  if (!res.ok) throw new Error(`${method} failed (${res.status}): ${await res.text().catch(() => '')}`);
  return res.json();
}

export async function serviceCreateRecord(collection, record) {
  const { did } = await getServiceIdentity();
  return authedXrpc('com.atproto.repo.createRecord', { repo: did, collection, record });
}

export async function servicePutRecord(collection, rkey, record) {
  const { did } = await getServiceIdentity();
  return authedXrpc('com.atproto.repo.putRecord', { repo: did, collection, rkey, record });
}

export async function serviceDeleteRecord(collection, rkey) {
  const { did } = await getServiceIdentity();
  await authedXrpc('com.atproto.repo.deleteRecord', { repo: did, collection, rkey });
}

// Public read against the service repo — no auth needed, but we reuse the resolved
// PDS. Returns null on 404 so callers can disambiguate a service record from a
// legacy creator-repo one.
export async function serviceGetRecord(collection, rkey) {
  const { did, pds } = await getServiceIdentity();
  const url = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getRecord failed (${res.status})`);
  return res.json();
}

// Test-only: reset cached identity/tokens.
export function __resetForTest() { identity = null; tokens = null; }
