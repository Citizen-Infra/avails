import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, listTools } from '../src/mcp/tools.js';
import { indexPoll, listByCommunity, removePoll } from '../src/lib/pollIndex.js';

const originalFetch = globalThis.fetch;
const did = 'did:plc:creator';
const rkey = 'poll1';

afterEach(() => {
  globalThis.fetch = originalFetch;
  removePoll(did, rkey);
});

describe('MCP update_poll community parity', () => {
  it('advertises the same community field as the REST update route', () => {
    const tool = listTools().find((candidate) => candidate.name === 'update_poll');
    assert.equal(tool.inputSchema.properties.community.type, 'string');
  });

  it('links an existing poll and re-points its community index entry', async () => {
    const existing = {
      $type: 'chat.avails.scheduling.poll',
      title: 'SEN kickoff',
      dates: ['2026-09-21'],
      timeRange: { start: '15:00', end: '21:00' },
      slotMinutes: 30,
      timezone: 'Europe/Budapest',
      status: 'open',
      createdAt: '2026-09-15T00:00:00.000Z',
    };
    let putBody;

    globalThis.fetch = async (url) => {
      if (String(url).startsWith('https://plc.directory/')) {
        return {
          ok: true,
          json: async () => ({
            service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.test' }],
          }),
        };
      }
      assert.match(String(url), /com\.atproto\.repo\.getRecord/);
      return { ok: true, json: async () => ({ cid: 'old-cid', value: existing }) };
    };
    const authContext = {
      did,
      oauthSession: {
        fetchHandler: async (_path, options) => {
          putBody = JSON.parse(options.body);
          return { ok: true, json: async () => ({ uri: `at://${did}/chat.avails.scheduling.poll/${rkey}`, cid: 'new-cid' }) };
        },
      },
    };
    indexPoll(did, rkey, { ...existing, community: undefined, responseCount: 3 });

    const result = JSON.parse(await callTool('update_poll', {
      rkey,
      community: 'sen-response-group',
    }, authContext));

    assert.equal(result.poll.community, 'sen-response-group');
    assert.equal(putBody.record.community, 'sen-response-group');
    assert.equal(putBody.swapRecord, 'old-cid');
    assert.equal(listByCommunity('sen-response-group')[0].rkey, rkey);
    assert.equal(listByCommunity('sen-response-group')[0].responseCount, 3);
  });
});
