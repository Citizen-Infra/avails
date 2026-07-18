import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// serviceSession caches identity + tokens at module scope; import fresh per concern
// via a query-string cache-bust so each test starts clean.
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

test('isServiceConfigured reflects both env vars', async () => {
  const mod = await import('../src/lib/serviceSession.js?case=cfg');
  delete process.env.AVAILS_SERVICE_IDENTIFIER;
  delete process.env.AVAILS_SERVICE_APP_PASSWORD;
  assert.equal(mod.isServiceConfigured(), false);
  process.env.AVAILS_SERVICE_IDENTIFIER = 'avails.zhgnv.com';
  process.env.AVAILS_SERVICE_APP_PASSWORD = 'app-pw';
  assert.equal(mod.isServiceConfigured(), true);
});

test('serviceCreateRecord logs in once, then writes with the access token', async () => {
  process.env.AVAILS_SERVICE_IDENTIFIER = 'avails.zhgnv.com';
  process.env.AVAILS_SERVICE_APP_PASSWORD = 'app-pw';
  process.env.AVAILS_SERVICE_PDS = 'https://pds.test';
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); calls.push(u);
    if (u.includes('com.atproto.server.createSession')) {
      return { ok: true, json: async () => ({ accessJwt: 'A1', refreshJwt: 'R1', did: 'did:plc:svc' }) };
    }
    if (u.includes('com.atproto.repo.createRecord')) {
      assert.equal(opts.headers.Authorization, 'Bearer A1');
      return { ok: true, json: async () => ({ uri: 'at://did:plc:svc/c/xyz', cid: 'cid1' }) };
    }
    throw new Error(`unexpected ${u}`);
  };
  const mod = await import('../src/lib/serviceSession.js?case=create');
  const r = await mod.serviceCreateRecord('chat.avails.scheduling.response', { pollUri: 'at://x/y/z' });
  assert.equal(r.uri, 'at://did:plc:svc/c/xyz');
  assert.equal(calls.filter((c) => c.includes('createSession')).length, 1);
});

test('an expired access token triggers refresh then retry', async () => {
  process.env.AVAILS_SERVICE_IDENTIFIER = 'avails.zhgnv.com';
  process.env.AVAILS_SERVICE_APP_PASSWORD = 'app-pw';
  process.env.AVAILS_SERVICE_PDS = 'https://pds.test';
  let wrote = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('createSession')) return { ok: true, json: async () => ({ accessJwt: 'A1', refreshJwt: 'R1', did: 'did:plc:svc' }) };
    if (u.includes('refreshSession')) {
      assert.equal(opts.headers.Authorization, 'Bearer R1');
      return { ok: true, json: async () => ({ accessJwt: 'A2', refreshJwt: 'R2', did: 'did:plc:svc' }) };
    }
    if (u.includes('createRecord')) {
      if (opts.headers.Authorization === 'Bearer A1') {
        return { ok: false, status: 400, json: async () => ({ error: 'ExpiredToken' }), text: async () => 'ExpiredToken' };
      }
      assert.equal(opts.headers.Authorization, 'Bearer A2'); wrote++;
      return { ok: true, json: async () => ({ uri: 'at://did:plc:svc/c/ok', cid: 'c' }) };
    }
    throw new Error(`unexpected ${u}`);
  };
  const mod = await import('../src/lib/serviceSession.js?case=refresh');
  const r = await mod.serviceCreateRecord('c', { pollUri: 'p' });
  assert.equal(r.uri, 'at://did:plc:svc/c/ok');
  assert.equal(wrote, 1);
});

test('serviceGetRecord returns null on 404', async () => {
  process.env.AVAILS_SERVICE_IDENTIFIER = 'avails.zhgnv.com';
  process.env.AVAILS_SERVICE_APP_PASSWORD = 'app-pw';
  process.env.AVAILS_SERVICE_PDS = 'https://pds.test';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('createSession')) return { ok: true, json: async () => ({ accessJwt: 'A1', refreshJwt: 'R1', did: 'did:plc:svc' }) };
    if (u.includes('getRecord')) return { ok: false, status: 404, text: async () => 'not found' };
    throw new Error(`unexpected ${u}`);
  };
  const mod = await import('../src/lib/serviceSession.js?case=get404');
  assert.equal(await mod.serviceGetRecord('c', 'missing'), null);
});
