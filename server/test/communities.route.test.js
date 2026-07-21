import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.CA_MEMBERSHIP_URL = 'https://ca.test';
process.env.CA_CONFIG_SECRET = 'svc-secret';

let fetchImpl;
const originalFetch = globalThis.fetch;
globalThis.fetch = (...a) => fetchImpl(...a);

const { default: communitiesRoutes } = await import('../src/routes/communities.js');

function createApp() {
  const app = express();
  app.use('/api/communities', communitiesRoutes);
  return app;
}

async function request(app, path) {
  const { once } = await import('node:events');
  const server = app.listen(0);
  await once(server, 'listening');
  const port = server.address().port;
  try {
    const res = await originalFetch(`http://localhost:${port}${path}`);
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

describe('GET /api/communities', () => {
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
