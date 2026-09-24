import { createPublicKey, verify } from 'node:crypto';
import { fetchCommunityConfig } from './communityConfig.js';
import { fetchMemberships } from './membership.js';
import { getSession } from './sessionStore.js';

const JWKS_TTL_MS = 60 * 60 * 1000;
let cachedKeys = null;
let keysExpireAt = 0;
let nextKeyMissRefreshAt = 0;

async function signingKey(kid) {
  const now = Date.now();
  if (!cachedKeys || now >= keysExpireAt
    || (now >= nextKeyMissRefreshAt && !cachedKeys.some((key) => key.kid === kid))) {
    const base = process.env.CA_MEMBERSHIP_URL?.replace(/\/$/, '');
    if (!base) return null;
    const response = await fetch(`${base}/.well-known/jwks.json`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Community identity keys unavailable');
    const data = await response.json();
    if (!Array.isArray(data.keys)) throw new Error('Invalid community identity keys');
    cachedKeys = data.keys;
    keysExpireAt = Date.now() + JWKS_TTL_MS;
    // Unknown kids can request an early rotation refresh, but never on every
    // attacker-controlled token: throttle misses to once a minute.
    nextKeyMissRefreshAt = Date.now() + 60 * 1000;
  }
  const key = cachedKeys.find((item) => item.kid === kid && item.kty === 'EC'
    && item.crv === 'P-256' && item.alg === 'ES256' && item.use === 'sig' && !item.d);
  return key ? createPublicKey({ key, format: 'jwk' }) : null;
}

// Community Admin issues short-lived ES256 identity tokens. The claims are not
// trusted until the signature, issuer (when configured), and expiry are checked.
// No token or JWKS response is ever logged. A failed lookup grants no membership.
async function memberIdsFromToken(token) {
  try {
    if (token.length > 16_384) return [];
    const parts = token.split('.');
    if (parts.length !== 3) return [];
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (header.alg !== 'ES256' || typeof header.kid !== 'string' || !header.kid) return [];
    const key = await signingKey(header.kid);
    if (!key || !verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`),
      { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'))) return [];
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const now = Date.now() / 1000;
    if (typeof claims.exp !== 'number' || claims.exp <= now - 30
      || (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now + 30))
      || typeof claims.sub !== 'string' || !claims.sub
      || typeof claims.iss !== 'string' || !claims.iss
      || (process.env.CA_ISSUER && claims.iss !== process.env.CA_ISSUER)) return [];
    return Array.isArray(claims.memberships)
      ? claims.memberships.map((entry) => entry?.community_id).filter((id) => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

// Authorization applies to discovery, not known poll URLs or public PDS records.
// A community absent from active config can still be private/setup: a verified
// member may discover its polls, but anonymous callers may not.
export async function mayListCommunityPolls(community, { bearer, sessionId, did } = {}) {
  const config = await fetchCommunityConfig(); // outage must not make a private poll public
  if (config[community]?.visibility === 'public') return true;

  if (bearer) {
    return (await memberIdsFromToken(bearer)).includes(community);
  }
  const memberDid = did || (sessionId && getSession(sessionId)?.did);
  if (!memberDid) return false;
  try {
    const memberships = await fetchMemberships(memberDid);
    return memberships.some((membership) => membership?.community_id === community);
  } catch {
    return false;
  }
}
