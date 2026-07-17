/**
 * Tests for requireAuth's lazy OAuth-session restore.
 *
 * The startup restore fetches client-metadata.json from the server's own PUBLIC
 * URL, which Railway's edge doesn't route to until the deploy is healthy — so
 * every redeploy leaves sessions with `oauthSession: null`, logged as "will
 * retry on demand". Nothing retried it, so the next authenticated write hit
 * `oauthSession.fetchHandler` on null and threw at the user (2026-07-17, real
 * report: "Cannot read properties of null (reading 'fetchHandler')").
 *
 * Requires --experimental-test-module-mocks.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const DID = 'did:plc:caller';

let restoreImpl;
mock.module('../src/routes/auth.js', {
  namedExports: {
    getClient: async () => ({ restore: (did) => restoreImpl(did) }),
  },
});

const mockSessions = new Map();
mock.module('../src/lib/sessionStore.js', {
  namedExports: {
    sessions: mockSessions,
    getSession: (id) => mockSessions.get(id),
  },
});

const { requireAuth } = await import('../src/middleware/auth.js');

function mkRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function mkReq(cookie) {
  return { cookies: cookie ? { avails_session: cookie } : {} };
}

describe('requireAuth', () => {
  beforeEach(() => {
    mockSessions.clear();
    restoreImpl = async () => {
      throw new Error('restore should not be called in this test');
    };
  });

  it('401s with no cookie', async () => {
    const res = mkRes();
    let nexted = false;
    await requireAuth(mkReq(null), res, () => { nexted = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(nexted, false);
  });

  it('401s when the session id is unknown', async () => {
    const res = mkRes();
    let nexted = false;
    await requireAuth(mkReq('nope'), res, () => { nexted = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(nexted, false);
  });

  it('passes a live session straight through without restoring', async () => {
    const live = { fetchHandler: async () => ({ ok: true }) };
    mockSessions.set('sid', { did: DID, handle: 'caller.test', oauthSession: live });

    const req = mkReq('sid');
    const res = mkRes();
    let nexted = false;
    await requireAuth(req, res, () => { nexted = true; });

    assert.equal(nexted, true);
    assert.equal(req.userDid, DID);
    assert.equal(req.oauthSession, live);
  });

  it('lazy-restores a session deferred by a failed startup restore', async () => {
    // This is the real-world case: cookie valid, oauthSession null because the
    // deploy-time restore couldn't reach its own metadata URL yet.
    const restored = { fetchHandler: async () => ({ ok: true }) };
    let restoreCalledWith = null;
    restoreImpl = async (did) => { restoreCalledWith = did; return restored; };
    mockSessions.set('sid', { did: DID, handle: 'caller.test', oauthSession: null });

    const req = mkReq('sid');
    const res = mkRes();
    let nexted = false;
    await requireAuth(req, res, () => { nexted = true; });

    assert.equal(restoreCalledWith, DID);
    assert.equal(nexted, true);
    assert.equal(req.oauthSession, restored, 'the write path must receive a live session');
    assert.equal(
      mockSessions.get('sid').oauthSession,
      restored,
      'the restored session must be cached back, not re-restored on every request'
    );
  });

  it('401s instead of passing null downstream when the restore fails', async () => {
    // Before the fix this fell through with oauthSession: null and the route
    // threw "Cannot read properties of null (reading 'fetchHandler')".
    restoreImpl = async () => { throw new Error('invalid_client_metadata'); };
    mockSessions.set('sid', { did: DID, handle: 'caller.test', oauthSession: null });

    const req = mkReq('sid');
    const res = mkRes();
    let nexted = false;
    await requireAuth(req, res, () => { nexted = true; });

    assert.equal(nexted, false, 'must not hand a null oauthSession to the route');
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /sign in again/i);
  });
});
