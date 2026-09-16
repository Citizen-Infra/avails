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
        { uri: 'at://c/r/leg1', cid: 'c1', value: { pollUri: `at://${CREATOR}/p/poll1`, name: 'Legacy', slots: ['2026-09-22T15:00', '2026-09-21T15:00'] } },
        { uri: 'at://c/r/other', cid: 'c9', value: { pollUri: `at://${CREATOR}/p/OTHER`, name: 'Nope' } },
      ] }) };
    }
    if (u.includes('svc.pds') && u.includes('listRecords')) {
      if (!u.includes('cursor=')) return { ok: true, json: async () => ({ cursor: 'pg2', records: [
        { uri: 'at://s/r/s1', cid: 's1', value: { pollUri: `at://${CREATOR}/p/poll1`, name: 'New1', slots: ['2026-09-22T15:30', '2026-09-22T15:15'] } },
      ] }) };
      return { ok: true, json: async () => ({ records: [
        { uri: 'at://s/r/s2', cid: 's2', value: { pollUri: `at://${CREATOR}/p/poll1`, name: 'New2', slots: ['2026-09-22T20:30', '2026-09-22T21:00'] } },
      ] }) };
    }
    throw new Error(`unexpected ${u}`);
  };
  const { fetchPollResponses } = await import('../src/lib/responseReads.js?case=merge');
  const poll = {
    dates: ['2026-09-22'],
    timeRange: { start: '15:00', end: '21:00' },
    slotMinutes: 30,
  };
  const out = await fetchPollResponses(CREATOR, 'poll1', poll);
  const names = out.map((r) => r.name).sort();
  assert.deepEqual(names, ['Legacy', 'New1', 'New2']);
  assert.equal(out.find((r) => r.name === 'Legacy').home, 'creator');
  assert.equal(out.find((r) => r.name === 'New2').home, 'service');
  assert.deepEqual(out.find((r) => r.name === 'Legacy').slots, ['2026-09-22T15:00']);
  assert.deepEqual(out.find((r) => r.name === 'New1').slots, ['2026-09-22T15:30']);
  assert.deepEqual(out.find((r) => r.name === 'New2').slots, ['2026-09-22T20:30']);
});

test('when service not configured, returns creator responses only', async () => {
  delete process.env.AVAILS_SERVICE_IDENTIFIER;
  delete process.env.AVAILS_SERVICE_APP_PASSWORD;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('plc.directory')) return { ok: true, json: async () => ({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://creator.pds' }] }) };
    if (u.includes('listRecords')) return { ok: true, json: async () => ({ records: [
      { uri: 'at://c/r/1', cid: 'c1', value: {
        pollUri: 'at://did:plc:creator/p/poll1',
        name: 'Only',
        slots: ['2026-09-22T15:00', '2026-09-22T16:00'],
      } },
    ] }) };
    throw new Error(`unexpected ${u}`);
  };
  const { fetchPollResponses } = await import('../src/lib/responseReads.js?case=nocfg');
  const out = await fetchPollResponses('did:plc:creator', 'poll1', {
    dates: ['2026-09-22'],
    earliestTime: '15:00',
    latestTime: '16:00',
    slotDuration: 30,
  });
  assert.deepEqual(out.map((r) => r.name), ['Only']);
  assert.deepEqual(out[0].slots, ['2026-09-22T15:00']);
});

test('sanitizer filters removed dates, out-of-range times, bad alignment, and malformed slots', async () => {
  const { sanitizePollResponses } = await import('../src/lib/responseReads.js?case=sanitize');
  const { computeBestSlots } = await import('../src/mcp/overlap.js');
  const poll = {
    dates: ['2026-09-22', '2026-09-23'],
    timeRange: { start: '15:00', end: '17:00' },
    slotMinutes: 30,
  };
  const responses = sanitizePollResponses([{
    name: 'Artem',
    slots: [
      '2026-09-22T15:00',
      '2026-09-23T16:30',
      '2026-09-21T15:00',
      '2026-09-22T14:30',
      '2026-09-22T17:00',
      '2026-09-22T15:15',
      'not-a-slot',
    ],
  }, { name: 'Missing slots' }], poll);

  assert.deepEqual(responses[0].slots, ['2026-09-22T15:00', '2026-09-23T16:30']);
  assert.deepEqual(responses[1].slots, []);
  assert.deepEqual(computeBestSlots(responses).map((entry) => entry.slot), [
    '2026-09-22T15:00',
    '2026-09-23T16:30',
  ]);
});
