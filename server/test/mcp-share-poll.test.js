import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.CA_MEMBERSHIP_URL = 'https://ca.test';
process.env.CA_CONFIG_SECRET = 'svc-secret';

let fetchImpl;
globalThis.fetch = (...a) => fetchImpl(...a);

const { callTool } = await import('../src/mcp/tools.js');

describe('share_poll membership gate', () => {
  it('denies a non-member before any Telegram or PDS call', async () => {
    let telegramCalled = false;
    fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/api/memberships')) {
        return { ok: true, json: async () => ({ subject: 'did:plc:art', memberships: [] }) }; // not a member
      }
      if (u.includes('telegram')) telegramCalled = true;
      return { ok: true, json: async () => ({}) };
    };
    await assert.rejects(
      () => callTool('share_poll', { did: 'did:plc:creator', rkey: 'r1', community: 'cibc' }, { did: 'did:plc:art' }),
      /not a member of "cibc"/
    );
    assert.equal(telegramCalled, false);
  });
});
