import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePollResponses } from '../src/lib/responseReads.js?mcp-sanitizer';

let receivedPoll;
const storedResponses = [
  {
    name: 'ServicePerson',
    slots: [
      '2026-09-22T15:00',
      '2026-09-22T15:30',
      '2026-09-21T15:00',
      '2026-09-22T15:15',
    ],
    uri: 'at://did:plc:service/chat.avails.scheduling.response/response1',
    cid: 'response-cid',
    home: 'service',
  },
];

// New responses live in the service repo (#42). MCP get_poll must use the same
// merged reader as REST rather than listing only the poll creator's repo.
mock.module('../src/lib/responseReads.js', {
  namedExports: {
    fetchPollResponses: async (_did, _rkey, poll) => {
      receivedPoll = poll;
      return sanitizePollResponses(storedResponses, poll);
    },
  },
});

let listedCreatorResponses = false;
globalThis.fetch = async (url) => {
  const value = String(url);
  if (value.includes('plc.directory')) {
    return {
      ok: true,
      json: async () => ({
        service: [{ id: '#atproto_pds', serviceEndpoint: 'https://creator.pds' }],
      }),
    };
  }
  if (value.includes('getRecord')) {
    return {
      ok: true,
      json: async () => ({
        value: {
          title: 'SEN kickoff',
          status: 'open',
          dates: ['2026-09-22'],
          timeRange: { start: '15:00', end: '16:00' },
          slotMinutes: 30,
        },
        uri: 'at://did:plc:creator/chat.avails.scheduling.poll/poll1',
        cid: 'poll-cid',
      }),
    };
  }
  if (value.includes('listRecords')) {
    listedCreatorResponses = true;
    return { ok: true, json: async () => ({ records: [] }) };
  }
  throw new Error(`unexpected fetch: ${value}`);
};

const { callTool } = await import('../src/mcp/tools.js');

describe('MCP get_poll response reads', () => {
  it('returns service-repo responses through the shared merged reader', async () => {
    const result = JSON.parse(await callTool('get_poll', {
      did: 'did:plc:creator',
      rkey: 'poll1',
    }));

    assert.equal(result.responses.length, 1);
    assert.equal(result.responses[0].home, 'service');
    assert.deepEqual(result.responses[0].slots, [
      '2026-09-22T15:00',
      '2026-09-22T15:30',
    ]);
    assert.deepEqual(receivedPoll, result.poll);
    assert.deepEqual(result.bestSlots, [
      { slot: '2026-09-22T15:00', count: 1, participants: ['ServicePerson'] },
      { slot: '2026-09-22T15:30', count: 1, participants: ['ServicePerson'] },
    ]);
    assert.equal(listedCreatorResponses, false,
      'get_poll should not bypass the merged response reader');
  });
});
