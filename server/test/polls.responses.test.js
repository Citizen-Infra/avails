import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// The read path should get its responses from the merged creator+service helper,
// not from an inline creator-only listRecords.
mock.module('../src/lib/responseReads.js', {
  namedExports: {
    fetchPollResponses: async () => ([
      { name: 'LegacyPerson', slots: ['2026-07-21T09:00'], uri: 'at://c/r/1', cid: 'c1', home: 'creator' },
      { name: 'ServicePerson', slots: ['2026-07-21T09:00'], uri: 'at://s/r/2', cid: 's2', home: 'service' },
    ]),
  },
});

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('plc.directory')) return { ok: true, json: async () => ({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://creator.pds' }] }) };
  if (u.includes('getRecord')) return { ok: true, json: async () => ({ value: { title: 'Test Poll', status: 'open' }, uri: 'at://did:plc:creator/p/poll1', cid: 'pcid' }) };
  // Legacy inline read (pre-refactor) would hit this and get nothing → RED until the route uses the helper.
  if (u.includes('listRecords')) return { ok: true, json: async () => ({ records: [] }) };
  return originalFetch(url);
};

const { default: pollRoutes } = await import('../src/routes/polls.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/polls', pollRoutes);
  return app;
}

async function request(app, method, path) {
  const { once } = await import('node:events');
  const server = app.listen(0);
  await once(server, 'listening');
  const port = server.address().port;
  try {
    const res = await originalFetch(`http://localhost:${port}${path}`, { method });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

describe('GET /:did/:rkey merges creator + service responses', () => {
  it('returns both legacy and service responses from the merged helper', async () => {
    const app = createApp();
    const res = await request(app, 'GET', '/api/polls/did:plc:creator/poll1');
    assert.equal(res.status, 200);
    assert.equal(res.body.responses.length, 2);
    assert.deepEqual(res.body.responses.map((r) => r.home).sort(), ['creator', 'service']);
  });
});
