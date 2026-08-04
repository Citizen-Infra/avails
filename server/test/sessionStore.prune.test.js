/**
 * Tests for the boot-time session prune (#117).
 *
 * Boot used to call `client.restore(did)` for every persisted session. That
 * restore triggers a token refresh against the user's PDS authorization server,
 * and THAT server fetches our `client_id` URL to validate the private_key_jwt.
 * Railway's edge doesn't route to a fresh container until its health check
 * passes, so the authorization server's fetch lost the race on roughly half of
 * boots and replied `invalid_client_metadata`.
 *
 * The fetch belongs to a remote server, so no local ordering can make it
 * deterministic. The boot path is now purely local: prune stale entries, and
 * let the request paths restore on demand (requireAuth, findOauthSessionByDid,
 * mcp/handler) — they run when the edge is definitely routing.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/lib/sessionStore.js';

const { sessions, cleanupExpiredSessions } = store;

const DAY = 24 * 60 * 60 * 1000;
const fresh = () => Date.now() - DAY;
const ancient = () => Date.now() - 31 * DAY;

beforeEach(() => sessions.clear());

test('drops sessions past the 30-day cutoff', () => {
  sessions.set('old', { did: 'did:plc:a', createdAt: ancient() });
  cleanupExpiredSessions();
  assert.equal(sessions.has('old'), false);
});

test('keeps a fresh session whose oauthSession is null', () => {
  // The load-bearing case for dropping the startup restore. Every persisted
  // session arrives at boot with no live oauthSession, because the live object
  // is stripped before serializing. Pruning them would sign everyone out on
  // every deploy; deferring them is what the lazy restore repairs.
  sessions.set('deferred', { did: 'did:plc:b', createdAt: fresh(), oauthSession: null });
  cleanupExpiredSessions();
  assert.equal(sessions.has('deferred'), true);
  assert.equal(sessions.get('deferred').oauthSession, null, 'prune must not fabricate a session');
});

test('drops an entry with no did, which can never be restored', () => {
  sessions.set('junk', { createdAt: fresh() });
  cleanupExpiredSessions();
  assert.equal(sessions.has('junk'), false);
});

test('leaves a live session untouched', () => {
  const live = { fetchHandler: async () => ({ ok: true }) };
  sessions.set('live', { did: 'did:plc:c', createdAt: fresh(), oauthSession: live });
  cleanupExpiredSessions();
  assert.equal(sessions.get('live').oauthSession, live);
});

test('the boot path no longer exposes a network restore', () => {
  // restoreOAuthSessions was the only caller of client.restore outside a
  // request. Its removal is the fix, so its absence is the assertion.
  assert.equal(
    Object.keys(store).includes('restoreOAuthSessions'),
    false,
    'restoreOAuthSessions is gone: boot must not touch the network'
  );
});

test('the prune takes no OAuth client', () => {
  assert.equal(cleanupExpiredSessions.length, 0);
});
