/**
 * Integration tests for the availability CRUD routes.
 * Mirrors test/responses.test.js: mocks the session store + PDS layer to
 * isolate route logic, and verifies every write goes through validation
 * middleware before reaching the PDS.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';

const AVAILABILITY_COLLECTION = 'chat.avails.scheduling.availability';
const did = 'did:plc:testcaller';

// Mock sessionStore before importing routes — the module caches on import.
// requireAuth (middleware/auth.js) reads getSession()/sessions from this
// same module, so mocking it here also governs auth for the router.
const mockSessions = new Map();
mock.module('../src/lib/sessionStore.js', {
  namedExports: {
    sessions: mockSessions,
    getSession: (id) => mockSessions.get(id),
    createSession: () => 'mock-session-id',
    deleteSession: () => {},
    restoreOAuthSessions: async () => {},
    cleanupExpiredSessions: () => {},
    getOAuthSession: () => null,
  },
});

// Track XRPC calls made through the mocked OAuth session
let lastXrpcCall = null;
const mockFetchHandler = async (pathname, opts) => {
  const body = JSON.parse(opts.body);
  lastXrpcCall = { pathname, body };
  const method = pathname.replace('/xrpc/', '');
  if (method === 'com.atproto.repo.createRecord') {
    return {
      ok: true,
      json: async () => ({ uri: `at://${did}/${AVAILABILITY_COLLECTION}/newrkey001`, cid: 'cid-new' }),
      text: async () => 'ok',
    };
  }
  if (method === 'com.atproto.repo.putRecord') {
    return {
      ok: true,
      json: async () => ({ uri: `at://${did}/${AVAILABILITY_COLLECTION}/${body.rkey}`, cid: 'cid-updated' }),
      text: async () => 'ok',
    };
  }
  // deleteRecord
  return { ok: true, json: async () => ({}), text: async () => 'ok' };
};

// Mock fetch globally for resolvePds + listRecords calls
let mockListRecordsData = { records: [] };
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
  if (typeof url === 'string' && url.includes('listRecords')) {
    return { ok: true, json: async () => mockListRecordsData };
  }
  return originalFetch(url, opts);
};

const { default: availabilityRoutes } = await import('../src/routes/availability.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/availability', availabilityRoutes);
  return app;
}

// Helper: make HTTP request to the test app
async function request(app, method, path, body, cookie) {
  const { once } = await import('node:events');
  const server = app.listen(0);
  await once(server, 'listening');
  const port = server.address().port;

  try {
    const res = await originalFetch(`http://localhost:${port}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } finally {
    server.close();
  }
}

const validBody = {
  scope: { type: 'atproto-list', value: 'at://did:plc:owner/app.bsky.graph.list/abc' },
  pattern: { weekly: [{ day: 1, startTime: '09:00', endTime: '17:00' }] },
  timezone: 'Europe/Berlin',
  trust: 'confirm',
};

const sessionCookie = 'avails_session=creator-session';

describe('POST /api/availability', () => {
  beforeEach(() => {
    mockSessions.clear();
    lastXrpcCall = null;
    mockListRecordsData = { records: [] };
    mockSessions.set('creator-session', {
      did,
      handle: 'caller.test',
      oauthSession: { fetchHandler: mockFetchHandler },
    });
  });

  it('rejects unauthenticated requests', async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/api/availability', validBody);
    assert.equal(res.status, 401);
    assert.equal(lastXrpcCall, null);
  });

  it('rejects invalid body via validation middleware, no PDS write', async () => {
    const app = createApp();
    const res = await request(
      app,
      'POST',
      '/api/availability',
      { scope: { type: 'atproto-list' } },
      sessionCookie
    );
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
    assert.equal(lastXrpcCall, null);
  });

  it("creates a record writing to the caller's own PDS with defaults applied", async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/api/availability', validBody, sessionCookie);
    assert.equal(res.status, 201);
    assert.ok(lastXrpcCall);
    assert.equal(lastXrpcCall.pathname, '/xrpc/com.atproto.repo.createRecord');
    assert.equal(lastXrpcCall.body.repo, did);
    assert.equal(lastXrpcCall.body.collection, AVAILABILITY_COLLECTION);
    assert.equal(lastXrpcCall.body.record.$type, AVAILABILITY_COLLECTION);
    assert.equal(lastXrpcCall.body.record.trust, 'confirm');
    assert.deepStrictEqual(lastXrpcCall.body.record.scope, validBody.scope);
    assert.ok(lastXrpcCall.body.record.createdAt);
    // validUntil is defaulted by validateAvailability (Task 2) when omitted
    assert.ok(lastXrpcCall.body.record.validUntil);
    assert.equal(res.body.did, did);
    assert.equal(res.body.replaced, false);
  });

  it('replaces the prior record for the same scope.value instead of duplicating', async () => {
    mockListRecordsData = {
      records: [
        {
          uri: `at://${did}/${AVAILABILITY_COLLECTION}/oldrkey999`,
          cid: 'cid-old',
          value: {
            $type: AVAILABILITY_COLLECTION,
            scope: validBody.scope,
            pattern: { weekly: [{ day: 3, startTime: '10:00', endTime: '11:00' }] },
            timezone: 'UTC',
            trust: 'auto',
            createdAt: '2026-01-01T00:00:00.000Z',
            validUntil: '2026-02-01T00:00:00.000Z',
          },
        },
      ],
    };
    const app = createApp();
    const res = await request(app, 'POST', '/api/availability', validBody, sessionCookie);
    assert.equal(res.status, 200);
    assert.ok(lastXrpcCall);
    assert.equal(lastXrpcCall.pathname, '/xrpc/com.atproto.repo.putRecord');
    assert.equal(lastXrpcCall.body.repo, did);
    assert.equal(lastXrpcCall.body.collection, AVAILABILITY_COLLECTION);
    assert.equal(lastXrpcCall.body.rkey, 'oldrkey999');
    assert.equal(lastXrpcCall.body.swapRecord, 'cid-old');
    assert.equal(lastXrpcCall.body.record.trust, 'confirm'); // new value wins
    assert.equal(lastXrpcCall.body.record.createdAt, '2026-01-01T00:00:00.000Z'); // preserved
    assert.ok(lastXrpcCall.body.record.updatedAt);
    assert.equal(res.body.replaced, true);
  });
});

describe('GET /api/availability/mine', () => {
  beforeEach(() => {
    mockSessions.clear();
    lastXrpcCall = null;
    mockSessions.set('creator-session', {
      did,
      handle: 'caller.test',
      oauthSession: { fetchHandler: mockFetchHandler },
    });
  });

  it('rejects unauthenticated requests', async () => {
    const app = createApp();
    const res = await request(app, 'GET', '/api/availability/mine');
    assert.equal(res.status, 401);
  });

  it("lists the caller's availability records from their own PDS", async () => {
    mockListRecordsData = {
      records: [
        {
          uri: `at://${did}/${AVAILABILITY_COLLECTION}/rkey1`,
          cid: 'cid1',
          value: {
            ...validBody,
            $type: AVAILABILITY_COLLECTION,
            createdAt: '2026-03-01T00:00:00.000Z',
            validUntil: '2026-04-01T00:00:00.000Z',
          },
        },
      ],
    };
    const app = createApp();
    const res = await request(app, 'GET', '/api/availability/mine', undefined, sessionCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.records.length, 1);
    assert.equal(res.body.records[0].rkey, 'rkey1');
    assert.equal(res.body.records[0].did, did);
    assert.deepStrictEqual(res.body.records[0].scope, validBody.scope);
  });
});

describe('DELETE /api/availability/:rkey', () => {
  beforeEach(() => {
    mockSessions.clear();
    lastXrpcCall = null;
    mockSessions.set('creator-session', {
      did,
      handle: 'caller.test',
      oauthSession: { fetchHandler: mockFetchHandler },
    });
  });

  it('rejects unauthenticated requests', async () => {
    const app = createApp();
    const res = await request(app, 'DELETE', '/api/availability/rkey1');
    assert.equal(res.status, 401);
    assert.equal(lastXrpcCall, null);
  });

  it("deletes the record from the caller's own PDS", async () => {
    const app = createApp();
    const res = await request(app, 'DELETE', '/api/availability/rkey1', undefined, sessionCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(lastXrpcCall);
    assert.equal(lastXrpcCall.pathname, '/xrpc/com.atproto.repo.deleteRecord');
    assert.equal(lastXrpcCall.body.repo, did);
    assert.equal(lastXrpcCall.body.collection, AVAILABILITY_COLLECTION);
    assert.equal(lastXrpcCall.body.rkey, 'rkey1');
  });
});
