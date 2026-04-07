/**
 * Integration tests for response routes.
 * Verifies that validation middleware is wired up on all write endpoints.
 *
 * These tests import the Express router directly and mount it on a test app,
 * mocking the session store and PDS layer to isolate route logic.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// Mock sessionStore before importing routes — the module caches on import
const mockSessions = new Map();
mock.module('../src/lib/sessionStore.js', {
  namedExports: {
    sessions: mockSessions,
    getSession: (id) => mockSessions.get(id),
  },
});

// Mock pollIndex
mock.module('../src/lib/pollIndex.js', {
  namedExports: {
    incrementResponseCount: () => 1,
  },
});

// Mock email
mock.module('../src/lib/email.js', {
  namedExports: {
    sendEmail: async () => {},
  },
});

// Track XRPC calls made through the mocked OAuth session
let lastXrpcCall = null;
const mockFetchHandler = async (pathname, opts) => {
  lastXrpcCall = { pathname, body: JSON.parse(opts.body) };
  return {
    ok: true,
    json: async () => ({ uri: 'at://did:plc:test/chat.avails.scheduling.response/abc123' }),
    text: async () => 'ok',
  };
};

// Mock fetch globally for resolvePds calls
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.includes('plc.directory')) {
    return {
      ok: true,
      json: async () => ({
        service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://mock-pds.test' }],
      }),
    };
  }
  // Mock PDS poll fetch for notification check
  if (typeof url === 'string' && url.includes('getRecord')) {
    return {
      ok: true,
      json: async () => ({ value: { title: 'Test Poll' } }),
    };
  }
  return originalFetch(url, opts);
};

const { default: responseRoutes } = await import('../src/routes/responses.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/polls', responseRoutes);
  return app;
}

// Helper: make HTTP request to the test app
async function request(app, method, path, body) {
  const { once } = await import('node:events');
  const server = app.listen(0);
  await once(server, 'listening');
  const port = server.address().port;

  try {
    const res = await originalFetch(`http://localhost:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } finally {
    server.close();
  }
}

describe('POST /api/polls/:did/:rkey/responses', () => {
  const did = 'did:plc:testcreator';
  const rkey = 'poll123';
  const path = `/api/polls/${did}/${rkey}/responses`;

  beforeEach(() => {
    mockSessions.clear();
    lastXrpcCall = null;
    // Add a creator session
    mockSessions.set('creator-session', {
      did,
      oauthSession: { fetchHandler: mockFetchHandler },
    });
  });

  it('accepts valid response and writes correct record to PDS', async () => {
    const app = createApp();
    const res = await request(app, 'POST', path, {
      name: 'Alice',
      slots: ['2026-04-10T09:00', '2026-04-10T09:30'],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.ok, true);

    // Verify the record written to PDS has name and slots
    assert.ok(lastXrpcCall);
    assert.equal(lastXrpcCall.body.record.name, 'Alice');
    assert.deepStrictEqual(lastXrpcCall.body.record.slots, ['2026-04-10T09:00', '2026-04-10T09:30']);
  });

  it('rejects request with no name', async () => {
    const app = createApp();
    const res = await request(app, 'POST', path, {
      slots: ['2026-04-10T09:00'],
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('name'));
    assert.equal(lastXrpcCall, null); // No PDS write attempted
  });

  it('rejects request with no slots', async () => {
    const app = createApp();
    const res = await request(app, 'POST', path, {
      name: 'Alice',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('slots'));
    assert.equal(lastXrpcCall, null);
  });

  it('rejects empty body', async () => {
    const app = createApp();
    const res = await request(app, 'POST', path, {});
    assert.equal(res.status, 400);
    assert.equal(lastXrpcCall, null);
  });

  it('strips injected fields from record', async () => {
    const app = createApp();
    const res = await request(app, 'POST', path, {
      name: 'Alice',
      slots: ['2026-04-10T09:00'],
      $type: 'malicious.type',
      pollUri: 'at://hacked/collection/key',
    });
    assert.equal(res.status, 201);
    // $type should be set by the route, not by user input
    assert.equal(lastXrpcCall.body.record.$type, 'chat.avails.scheduling.response');
    // pollUri should be constructed by the route, not from user input
    assert.ok(lastXrpcCall.body.record.pollUri.includes(rkey));
    assert.ok(!lastXrpcCall.body.record.pollUri.includes('hacked'));
  });
});

describe('PUT /api/polls/:did/:rkey/responses/:responseRkey', () => {
  const did = 'did:plc:testcreator';
  const rkey = 'poll123';
  const responseRkey = 'resp456';
  const path = `/api/polls/${did}/${rkey}/responses/${responseRkey}`;

  beforeEach(() => {
    mockSessions.clear();
    lastXrpcCall = null;
    mockSessions.set('creator-session', {
      did,
      oauthSession: { fetchHandler: mockFetchHandler },
    });
  });

  it('accepts valid update and writes correct record to PDS', async () => {
    const app = createApp();
    const res = await request(app, 'PUT', path, {
      name: 'Alice',
      slots: ['2026-04-10T10:00', '2026-04-10T10:30'],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    // THE KEY ASSERTION: record must contain name and slots
    assert.ok(lastXrpcCall);
    assert.equal(lastXrpcCall.body.record.name, 'Alice');
    assert.deepStrictEqual(lastXrpcCall.body.record.slots, ['2026-04-10T10:00', '2026-04-10T10:30']);
  });

  it('rejects update with no name (prevents the corruption bug)', async () => {
    const app = createApp();
    const res = await request(app, 'PUT', path, {
      slots: ['2026-04-10T09:00'],
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('name'));
    assert.equal(lastXrpcCall, null); // No PDS write — data not corrupted
  });

  it('rejects update with no slots (prevents the corruption bug)', async () => {
    const app = createApp();
    const res = await request(app, 'PUT', path, {
      name: 'Alice',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('slots'));
    assert.equal(lastXrpcCall, null);
  });

  it('rejects empty body (the exact scenario that caused the bug)', async () => {
    const app = createApp();
    const res = await request(app, 'PUT', path, {});
    assert.equal(res.status, 400);
    assert.equal(lastXrpcCall, null);
  });

  it('returns 503 when creator session is missing', async () => {
    mockSessions.clear(); // No sessions at all
    const app = createApp();
    const res = await request(app, 'PUT', path, {
      name: 'Alice',
      slots: ['2026-04-10T09:00'],
    });
    assert.equal(res.status, 503);
    assert.ok(res.body.error.includes('unavailable'));
  });
});
