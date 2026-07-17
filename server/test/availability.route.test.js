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
// Every XRPC call in order — the legacy sweep (#106) makes more than one write
// per publish, which lastXrpcCall alone can't see.
let xrpcCalls = [];
// Lets one test drive the sweep's failure path.
let failDeletes = false;
const mockFetchHandler = async (pathname, opts) => {
  const body = JSON.parse(opts.body);
  lastXrpcCall = { pathname, body };
  xrpcCalls.push({ method: pathname.replace('/xrpc/', ''), body });
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
  if (failDeletes) {
    return { ok: false, status: 500, json: async () => ({}), text: async () => 'delete boom' };
  }
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
    xrpcCalls = [];
    failDeletes = false;
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
    // putRecord at a scope-derived rkey, not createRecord — see #106: a create
    // is the call that races into duplicates.
    assert.equal(lastXrpcCall.pathname, '/xrpc/com.atproto.repo.putRecord');
    assert.equal(lastXrpcCall.body.repo, did);
    assert.equal(lastXrpcCall.body.collection, AVAILABILITY_COLLECTION);
    assert.ok(lastXrpcCall.body.rkey);
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

    // The rkey now comes from the scope, not from whatever key the prior record
    // happened to have (#106) — so the legacy TID-keyed record is rewritten at
    // the deterministic key and the old one swept, rather than reused in place.
    const put = xrpcCalls.find((c) => c.method === 'com.atproto.repo.putRecord');
    assert.ok(put, 'must putRecord');
    assert.equal(put.body.repo, did);
    assert.equal(put.body.collection, AVAILABILITY_COLLECTION);
    assert.notEqual(put.body.rkey, 'oldrkey999');
    assert.equal(put.body.record.trust, 'confirm'); // new value wins
    assert.equal(put.body.record.createdAt, '2026-01-01T00:00:00.000Z'); // carried across the key change
    assert.ok(put.body.record.updatedAt);

    const del = xrpcCalls.find((c) => c.method === 'com.atproto.repo.deleteRecord');
    assert.ok(del, 'the legacy record must be swept, not left as a second public record');
    assert.equal(del.body.rkey, 'oldrkey999');

    assert.equal(res.body.replaced, true);
    assert.equal(res.body.staleRemaining, undefined);
  });

  it('derives the rkey from the scope so a re-publish overwrites rather than racing (#106)', async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/api/availability', validBody, sessionCookie);
    assert.equal(res.status, 201);

    // createRecord is what races — two concurrent POSTs could both create.
    // putRecord at a scope-derived key makes a duplicate unrepresentable.
    assert.equal(
      xrpcCalls.some((c) => c.method === 'com.atproto.repo.createRecord'),
      false,
      'must never createRecord — that is the racing call'
    );
    const put = xrpcCalls.find((c) => c.method === 'com.atproto.repo.putRecord');
    assert.ok(put);
    assert.match(put.body.rkey, /^[A-Za-z0-9._~-]{1,512}$/, 'valid ATProto rkey syntax');
    assert.equal(put.body.swapRecord, undefined, 'no CAS when there is no prior record at that key');

    // Same scope again -> same key. This is the property that kills the race.
    const firstRkey = put.body.rkey;
    xrpcCalls = [];
    await request(app, 'POST', '/api/availability', validBody, sessionCookie);
    const second = xrpcCalls.find((c) => c.method === 'com.atproto.repo.putRecord');
    assert.equal(second.body.rkey, firstRkey);
  });

  it('gives a different scope a different rkey', async () => {
    const app = createApp();
    await request(app, 'POST', '/api/availability', validBody, sessionCookie);
    const a = xrpcCalls.find((c) => c.method === 'com.atproto.repo.putRecord').body.rkey;

    xrpcCalls = [];
    await request(app, 'POST', '/api/availability', {
      ...validBody,
      scope: { type: 'atproto-list', value: 'at://did:plc:owner/app.bsky.graph.list/other' },
    }, sessionCookie);
    const b = xrpcCalls.find((c) => c.method === 'com.atproto.repo.putRecord').body.rkey;

    assert.notEqual(a, b, 'two scopes must not collide onto one record');
  });

  it('reports stale records it could not sweep instead of failing silently', async () => {
    mockListRecordsData = {
      records: [
        {
          uri: `at://${did}/${AVAILABILITY_COLLECTION}/legacytid01`,
          cid: 'cid-legacy',
          value: {
            $type: AVAILABILITY_COLLECTION,
            scope: validBody.scope,
            pattern: { weekly: [{ day: 3, startTime: '10:00', endTime: '11:00' }] },
            timezone: 'UTC',
            trust: 'auto',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
    };
    failDeletes = true;
    const app = createApp();
    const res = await request(app, 'POST', '/api/availability', validBody, sessionCookie);

    // The publish still succeeds — the new record landing is the outcome that
    // matters, and a failed cleanup must not roll it back.
    assert.equal(res.status, 200);
    assert.ok(xrpcCalls.find((c) => c.method === 'com.atproto.repo.putRecord'));
    assert.equal(res.body.staleRemaining, 1);
  });
});

describe('GET /api/availability/mine', () => {
  beforeEach(() => {
    mockSessions.clear();
    lastXrpcCall = null;
    xrpcCalls = [];
    failDeletes = false;
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
    xrpcCalls = [];
    failDeletes = false;
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
