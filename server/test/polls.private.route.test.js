import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import express from 'express';
import { indexPoll } from '../src/lib/pollIndex.js';

process.env.CA_MEMBERSHIP_URL = 'https://ca.test';
process.env.CA_CONFIG_SECRET = 'test-secret';
process.env.CA_ISSUER = 'https://ca.test';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'ES256', use: 'sig' };
const originalFetch = globalThis.fetch;
let caFetch;
globalThis.fetch = (url, options) => caFetch(String(url), options);

const [{ default: pollRoutes }, { sessions }, { callTool }] = await Promise.all([
  import('../src/routes/polls.js'),
  import('../src/lib/sessionStore.js'),
  import('../src/mcp/tools.js'),
]);

function token({ memberships = [], exp = Math.floor(Date.now() / 1000) + 900, issuer = 'https://ca.test' } = {}) {
  const head = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'test-key' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: 'user-123', iss: issuer, exp, memberships })).toString('base64url');
  const value = `${head}.${body}`;
  const signature = sign('sha256', Buffer.from(value), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${value}.${signature.toString('base64url')}`;
}

function app() {
  const instance = express();
  instance.use((req, _res, next) => {
    req.cookies = { avails_session: req.headers.cookie?.split('=')[1] };
    next();
  });
  instance.use('/api/polls', pollRoutes);
  return instance;
}

async function request(path, headers = {}) {
  const { once } = await import('node:events');
  const server = app().listen(0);
  await once(server, 'listening');
  try {
    const response = await originalFetch(`http://localhost:${server.address().port}${path}`, { headers });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  } finally {
    server.close();
  }
}

const config = { communities: {
  'open-group': { visibility: 'public' },
  'private-group': { visibility: 'private' },
} };
let configFails = false;
let membershipsFail = false;

beforeEach(() => {
  sessions.clear();
  configFails = false;
  membershipsFail = false;
  caFetch = async (url, options) => {
    if (url.endsWith('/api/config')) {
      assert.equal(options.headers.Authorization, 'Bearer test-secret');
      if (configFails) throw new Error('config down');
      return { ok: true, json: async () => config };
    }
    if (url.endsWith('/.well-known/jwks.json')) return { ok: true, json: async () => ({ keys: [jwk] }) };
    if (url.includes('/api/memberships')) {
      if (membershipsFail) throw new Error('membership down');
      return { ok: true, json: async () => ({ memberships: [
        { community_id: 'private-group', visibility: 'private' },
      ] }) };
    }
    throw new Error('Unexpected URL');
  };
});

after(() => { globalThis.fetch = originalFetch; });

describe('private-community poll discovery', () => {
  it('keeps public discovery and published-only filtering anonymous', async () => {
    indexPoll('did:plc:p', 'public', { title: 'Public', community: 'open-group' });
    const result = await request('/api/polls?community=open-group&published=1');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { polls: [] });
    assert.equal(result.cache, 'private, no-store');
    const all = await request('/api/polls?community=open-group');
    assert.deepEqual(all.body.polls.map((p) => p.title), ['Public']);
  });

  it('hides private polls even with published=1, status=finalized, unknown cookies or unrelated tokens', async () => {
    indexPoll('did:plc:p', 'private', { title: 'Private', community: 'private-group', publishedAt: '2026-09-01', status: 'finalized' });
    for (const headers of [{}, { Cookie: 'avails_session=unknown' },
      { Authorization: `Bearer ${token({ memberships: [{ community_id: 'open-group' }] })}` }]) {
      const response = await request('/api/polls?community=private-group&status=finalized&published=1', headers);
      assert.equal(response.status, 404);
      assert.equal(response.body.polls, undefined);
      assert.equal(response.cache, 'private, no-store');
    }
    assert.equal((await request('/api/polls?community=unknown')).status, 404);
  });

  it('accepts verified Community Admin member tokens, rejects forged, expired or wrong-issuer tokens', async () => {
    indexPoll('did:plc:p', 'member', { title: 'Member poll', community: 'private-group', publishedAt: '2026-09-01' });
    const signed = token({ memberships: [{ community_id: 'private-group' }] });
    assert.equal((await request('/api/polls?community=private-group&published=1', { Authorization: `Bearer ${signed}` })).body.polls[0].title, 'Member poll');
    for (const invalid of [
      `${signed.slice(0, -2)}xx`,
      token({ memberships: [{ community_id: 'private-group' }], exp: 1 }),
      token({ memberships: [{ community_id: 'private-group' }], issuer: 'wrong' }),
    ]) {
      assert.equal((await request('/api/polls?community=private-group', { Authorization: `Bearer ${invalid}` })).status, 404);
    }
  });

  it('lets a signed-in Avails member list private polls, but fails closed when membership cannot be checked', async () => {
    sessions.set('member-session', { did: 'did:plc:member', createdAt: Date.now() });
    const headers = { Cookie: 'avails_session=member-session' };
    assert.equal((await request('/api/polls?community=private-group', headers)).status, 200);
    membershipsFail = true;
    assert.equal((await request('/api/polls?community=private-group', headers)).status, 404);
  });

  it('denies every scope when community configuration is unavailable', async () => {
    configFails = true;
    assert.equal((await request('/api/polls?community=open-group')).status, 503);
    assert.equal((await request('/api/polls?community=private-group', {
      Authorization: `Bearer ${token({ memberships: [{ community_id: 'private-group' }] })}`,
    })).status, 503);
  });

  it('applies the same private listing rule to the MCP discovery tool', async () => {
    indexPoll('did:plc:p', 'public-mcp', { title: 'Public MCP', community: 'open-group' });
    indexPoll('did:plc:p', 'private-mcp', { title: 'Private MCP', community: 'private-group', status: 'finalized' });
    const publicPolls = JSON.parse(await callTool('list_polls', { community: 'open-group' }, null));
    assert.ok(publicPolls.polls.some((poll) => poll.title === 'Public MCP'));
    const anonymous = JSON.parse(await callTool('list_polls', { community: 'private-group' }, null));
    assert.deepEqual(anonymous.polls, []);
    const member = JSON.parse(await callTool('list_polls', { community: 'private-group', status: 'finalized' }, { did: 'did:plc:member' }));
    assert.ok(member.polls.some((poll) => poll.title === 'Private MCP'));
    membershipsFail = true;
    const failure = JSON.parse(await callTool('list_polls', { community: 'private-group' }, { did: 'did:plc:member' }));
    assert.deepEqual(failure.polls, []);
  });
});
