import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.CA_MEMBERSHIP_URL = 'https://ca.test';
process.env.CA_CONFIG_SECRET = 'svc-secret';

let fetchImpl;
globalThis.fetch = (...a) => fetchImpl(...a);

const { callTool } = await import('../src/mcp/tools.js');

describe('community config from community-admin /api/config', () => {
  it('list_communities reads /api/config (with the service bearer) and maps it', async () => {
    let captured;
    fetchImpl = async (url, opts) => {
      captured = { url: String(url), auth: opts?.headers?.Authorization };
      return { ok: true, json: async () => ({ communities: {
        cibc: { name: 'CIBC', group_id: '-100', output_channel: '-200', topics: { events: '24', news: '11' } },
        scenius: { name: 'Scenius', group_id: '-101', output_channel: null, topics: {} },
      } }) };
    };
    const res = JSON.parse(await callTool('list_communities', {}, null));
    assert.match(captured.url, /^https:\/\/ca\.test\/api\/config$/);
    assert.equal(captured.auth, 'Bearer svc-secret');
    assert.equal(res.length, 2);
    const cibc = res.find((c) => c.key === 'cibc');
    assert.equal(cibc.name, 'CIBC');
    assert.deepEqual(cibc.topics, ['events', 'news']);
    assert.equal(cibc.hasOutputChannel, true);
    assert.equal(res.find((c) => c.key === 'scenius').hasOutputChannel, false);
  });
});
