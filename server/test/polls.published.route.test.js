import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { indexPoll, updatePollPublished } from '../src/lib/pollIndex.js';

const originalFetch = globalThis.fetch;
const { default: pollRoutes } = await import('../src/routes/polls.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/polls', pollRoutes);
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

describe('GET /api/polls published filter', () => {
  it('returns all open polls without the param, published-only with published=1', async () => {
    indexPoll('did:plc:a', 'rt1', { title: 'RT1', community: 'c-route', status: 'open', createdAt: '2026-07-01T00:00:00Z' });
    indexPoll('did:plc:a', 'rt2', { title: 'RT2', community: 'c-route', status: 'open', createdAt: '2026-07-02T00:00:00Z' });
    updatePollPublished('did:plc:a', 'rt2', '2026-07-19T12:00:00Z');
    const app = createApp();

    const all = await request(app, '/api/polls?community=c-route');
    assert.equal(all.status, 200);
    assert.equal(all.body.polls.length, 2);

    const pub = await request(app, '/api/polls?community=c-route&published=1');
    assert.equal(pub.status, 200);
    assert.deepEqual(pub.body.polls.map((p) => p.rkey), ['rt2']);
  });

  it('still 400s without a community param', async () => {
    const app = createApp();
    const res = await request(app, '/api/polls');
    assert.equal(res.status, 400);
  });
});
