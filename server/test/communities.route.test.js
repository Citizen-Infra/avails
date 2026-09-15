import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.CA_MEMBERSHIP_URL = 'https://ca.test';
process.env.CA_CONFIG_SECRET = 'svc-secret';

let fetchImpl;
const originalFetch = globalThis.fetch;
globalThis.fetch = (...a) => fetchImpl(...a);

const [{ default: communitiesRoutes }, { sessions }] = await Promise.all([
  import('../src/routes/communities.js'),
  import('../src/lib/sessionStore.js'),
]);

function createApp() {
  const app = express();
  app.use((req, _res, next) => {
    const match = req.headers.cookie?.match(/(?:^|;\s*)avails_session=([^;]+)/);
    req.cookies = match ? { avails_session: match[1] } : {};
    next();
  });
  app.use('/api/communities', communitiesRoutes);
  return app;
}

async function request(app, path, cookie) {
  const { once } = await import('node:events');
  const server = app.listen(0);
  await once(server, 'listening');
  const port = server.address().port;
  try {
    const res = await originalFetch(`http://localhost:${port}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

describe('GET /api/communities', () => {
  beforeEach(() => sessions.clear());

  it('reads community-admin /api/config with the service bearer and returns [{id,name}] (public only)', async () => {
    let captured;
    fetchImpl = async (url, opts) => {
      captured = { url: String(url), auth: opts?.headers?.Authorization };
      return { ok: true, json: async () => ({ communities: {
        cibc: { name: 'Citizen Infra Builders', visibility: 'public' },
        priv: { name: 'Secret Room', visibility: 'private' },
      } }) };
    };
    const app = createApp();
    const res = await request(app, '/api/communities');
    assert.equal(res.status, 200);
    assert.match(captured.url, /^https:\/\/ca\.test\/api\/config$/);
    assert.equal(captured.auth, 'Bearer svc-secret');
    assert.ok(Array.isArray(res.body), 'body must be an array the client Select can map');
    // Private community must NOT leak to the unauthenticated web route.
    assert.deepEqual(res.body, [{ id: 'cibc', name: 'Citizen Infra Builders' }]);
  });

  it('adds the signed-in creator\'s private setup communities and deduplicates public memberships', async () => {
    sessions.set('creator-session', { did: 'did:plc:art', createdAt: Date.now() });
    const calls = [];
    fetchImpl = async (url, opts) => {
      calls.push({ url: String(url), auth: opts?.headers?.Authorization });
      if (String(url).includes('/api/memberships')) {
        return { ok: true, json: async () => ({ memberships: [
          { community_id: 'cibc', role: 'member', name: 'Citizen Infra Builders', status: 'active', visibility: 'public' },
          { community_id: 'sen-response-group', role: 'admin', name: 'SEN Response Group', status: 'setup', visibility: 'private' },
        ] }) };
      }
      return { ok: true, json: async () => ({ communities: {
        cibc: { name: 'Citizen Infra Builders', visibility: 'public' },
        unrelated: { name: 'Unrelated Private Group', visibility: 'private' },
      } }) };
    };

    const res = await request(createApp(), '/api/communities', 'avails_session=creator-session');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, [
      { id: 'cibc', name: 'Citizen Infra Builders' },
      { id: 'sen-response-group', name: 'SEN Response Group' },
    ]);
    const membershipCall = calls.find((call) => call.url.includes('/api/memberships'));
    assert.match(membershipCall.url, /subject=did%3Aplc%3Aart$/);
    assert.equal(membershipCall.auth, 'Bearer svc-secret');
  });

  it('does not request memberships for an unknown session', async () => {
    const calls = [];
    fetchImpl = async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ communities: {
        cibc: { name: 'Citizen Infra Builders', visibility: 'public' },
      } }) };
    };

    const res = await request(createApp(), '/api/communities', 'avails_session=unknown');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, [{ id: 'cibc', name: 'Citizen Infra Builders' }]);
    assert.equal(calls.some((url) => url.includes('/api/memberships')), false);
  });

  it('fails closed to public communities when the membership service is unavailable', async () => {
    sessions.set('creator-session', { did: 'did:plc:art', createdAt: Date.now() });
    fetchImpl = async (url) => {
      if (String(url).includes('/api/memberships')) throw new Error('network down');
      return { ok: true, json: async () => ({ communities: {
        cibc: { name: 'Citizen Infra Builders', visibility: 'public' },
        priv: { name: 'Secret Room', visibility: 'private' },
      } }) };
    };

    const res = await request(createApp(), '/api/communities', 'avails_session=creator-session');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, [{ id: 'cibc', name: 'Citizen Infra Builders' }]);
  });

  it('does not call scenius-digest', async () => {
    let calledScenius = false;
    fetchImpl = async (url) => {
      if (String(url).includes('scenius-digest')) calledScenius = true;
      return { ok: true, json: async () => ({ communities: {} }) };
    };
    const app = createApp();
    await request(app, '/api/communities');
    assert.equal(calledScenius, false, 'the deprecated scenius-digest path must be gone');
  });

  it('502s when community-admin is unreachable', async () => {
    fetchImpl = async () => { throw new Error('network down'); };
    const app = createApp();
    const res = await request(app, '/api/communities');
    assert.equal(res.status, 502);
  });
});
