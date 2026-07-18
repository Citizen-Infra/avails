import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
beforeEach(() => { process.env = { ...originalEnv }; globalThis.fetch = originalFetch; });

test('merges creator (legacy) + service responses, tags home, filters by poll, pages', async () => {
  process.env.AVAILS_SERVICE_IDENTIFIER = 'avails.zhgnv.com';
  process.env.AVAILS_SERVICE_APP_PASSWORD = 'pw';
  process.env.AVAILS_SERVICE_PDS = 'https://svc.pds';
  const CREATOR = 'did:plc:creator';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('plc.directory')) return { ok: true, json: async () => ({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://creator.pds' }] }) };
    if (u.includes('createSession')) return { ok: true, json: async () => ({ accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:svc' }) };
    if (u.includes('creator.pds') && u.includes('listRecords')) {
      return { ok: true, json: async () => ({ records: [
        { uri: 'at://c/r/leg1', cid: 'c1', value: { pollUri: `at://${CREATOR}/p/poll1`, name: 'Legacy' } },
        { uri: 'at://c/r/other', cid: 'c9', value: { pollUri: `at://${CREATOR}/p/OTHER`, name: 'Nope' } },
      ] }) };
    }
    if (u.includes('svc.pds') && u.includes('listRecords')) {
      if (!u.includes('cursor=')) return { ok: true, json: async () => ({ cursor: 'pg2', records: [
        { uri: 'at://s/r/s1', cid: 's1', value: { pollUri: `at://${CREATOR}/p/poll1`, name: 'New1' } },
      ] }) };
      return { ok: true, json: async () => ({ records: [
        { uri: 'at://s/r/s2', cid: 's2', value: { pollUri: `at://${CREATOR}/p/poll1`, name: 'New2' } },
      ] }) };
    }
    throw new Error(`unexpected ${u}`);
  };
  const { fetchPollResponses } = await import('../src/lib/responseReads.js?case=merge');
  const out = await fetchPollResponses(CREATOR, 'poll1');
  const names = out.map((r) => r.name).sort();
  assert.deepEqual(names, ['Legacy', 'New1', 'New2']);
  assert.equal(out.find((r) => r.name === 'Legacy').home, 'creator');
  assert.equal(out.find((r) => r.name === 'New2').home, 'service');
});

test('when service not configured, returns creator responses only', async () => {
  delete process.env.AVAILS_SERVICE_IDENTIFIER;
  delete process.env.AVAILS_SERVICE_APP_PASSWORD;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('plc.directory')) return { ok: true, json: async () => ({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://creator.pds' }] }) };
    if (u.includes('listRecords')) return { ok: true, json: async () => ({ records: [
      { uri: 'at://c/r/1', cid: 'c1', value: { pollUri: 'at://did:plc:creator/p/poll1', name: 'Only' } },
    ] }) };
    throw new Error(`unexpected ${u}`);
  };
  const { fetchPollResponses } = await import('../src/lib/responseReads.js?case=nocfg');
  const out = await fetchPollResponses('did:plc:creator', 'poll1');
  assert.deepEqual(out.map((r) => r.name), ['Only']);
});
