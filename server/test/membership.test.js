import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertMembership } from '../src/lib/membership.js';

let fetchImpl;
globalThis.fetch = (...args) => fetchImpl(...args);

describe('assertMembership', () => {
  beforeEach(() => {
    process.env.CA_MEMBERSHIP_URL = 'https://ca.test';
    process.env.CA_CONFIG_SECRET = 'svc-secret';
    fetchImpl = async () => ({ ok: true, json: async () => ({ subject: 'did:plc:art', memberships: [{ community_id: 'cibc', role: 'member' }] }) });
  });

  it('resolves when the DID is a member of the community', async () => {
    await assert.doesNotReject(() => assertMembership('did:plc:art', 'cibc'));
  });

  it('sends the service bearer and the url-encoded subject', async () => {
    let captured;
    fetchImpl = async (url, opts) => { captured = { url, opts }; return { ok: true, json: async () => ({ memberships: [{ community_id: 'cibc', role: 'member' }] }) }; };
    await assertMembership('did:plc:art', 'cibc');
    assert.match(String(captured.url), /\/api\/memberships\?subject=did%3Aplc%3Aart$/);
    assert.equal(captured.opts.headers.Authorization, 'Bearer svc-secret');
  });

  it('rejects when the DID is not a member of that community', async () => {
    fetchImpl = async () => ({ ok: true, json: async () => ({ memberships: [{ community_id: 'scenius', role: 'member' }] }) });
    await assert.rejects(() => assertMembership('did:plc:art', 'cibc'), /not a member of "cibc"/);
  });

  it('rejects (fail-closed) on a non-200 from community-admin', async () => {
    fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await assert.rejects(() => assertMembership('did:plc:art', 'cibc'), /Could not verify your membership/);
  });

  it('rejects (fail-closed) on a network error', async () => {
    fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
    await assert.rejects(() => assertMembership('did:plc:art', 'cibc'), /Could not verify your membership/);
  });

  it('rejects when not configured', async () => {
    delete process.env.CA_MEMBERSHIP_URL;
    await assert.rejects(() => assertMembership('did:plc:art', 'cibc'), /not configured/);
  });
});
