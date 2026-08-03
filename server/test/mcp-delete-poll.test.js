// delete_poll (#148). An agent could create polls through the MCP but never
// remove one, so verifying anything left permanent litter in the creator's repo.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

let fetchImpl;
globalThis.fetch = (...a) => fetchImpl(...a);

const { callTool, listTools } = await import('../src/mcp/tools.js');

// The real session exposes fetchHandler(pathname, init) — it owns DPoP and token
// refresh — so xrpcCall goes through it rather than global fetch. Record what it
// is asked to do.
const xrpcCalls = [];
const AUTH = {
  did: 'did:plc:creator',
  oauthSession: {
    fetchHandler: async (pathname, init) => {
      xrpcCalls.push({ pathname, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    },
  },
};
const PDS = 'https://pds.example';

// plc.directory resolution + a getRecord hit, with everything else recorded.
function pdsFetch({ record = { title: 'Team sync' }, found = true, calls = [] } = {}) {
  return async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, body: opts?.body ? JSON.parse(opts.body) : null });
    if (u.startsWith('https://plc.directory/')) {
      return {
        ok: true,
        json: async () => ({ service: [{ id: '#atproto_pds', serviceEndpoint: PDS }] }),
      };
    }
    if (u.includes('getRecord')) {
      if (!found) return { ok: false, status: 404, text: async () => 'RecordNotFound' };
      return { ok: true, json: async () => ({ value: record, cid: 'bafy1' }) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

describe('delete_poll', () => {
  it('is advertised so an agent can discover it', () => {
    const tool = listTools().find((t) => t.name === 'delete_poll');
    assert.ok(tool, 'delete_poll must be in TOOL_DEFINITIONS');
    assert.deepEqual(tool.inputSchema.required, ['rkey']);
  });

  it('deletes the poll from the caller\'s own repo', async () => {
    const calls = [];
    fetchImpl = pdsFetch({ calls });

    const out = JSON.parse(await callTool('delete_poll', { rkey: 'abc123' }, AUTH));
    assert.equal(out.ok, true);
    assert.deepEqual(out.deleted, { did: 'did:plc:creator', rkey: 'abc123', title: 'Team sync' });

    const del = xrpcCalls.find((c) => c.pathname.includes('deleteRecord'));
    assert.ok(del, 'must call com.atproto.repo.deleteRecord');
    assert.equal(del.body.repo, 'did:plc:creator');
    assert.equal(del.body.rkey, 'abc123');
    assert.equal(del.body.collection, 'chat.avails.scheduling.poll');
  });

  it('reads the record first so a wrong rkey is "not found", not a silent success', async () => {
    const calls = [];
    fetchImpl = pdsFetch({ found: false, calls });

    const before = xrpcCalls.length;
    await assert.rejects(() => callTool('delete_poll', { rkey: 'nope' }, AUTH), /Poll not found/);
    assert.equal(xrpcCalls.length, before,
      'must not delete when the record could not be read');
  });

  it('deletes a finalized poll too — this is error correction, and the REST route allows it', async () => {
    const calls = [];
    fetchImpl = pdsFetch({ record: { title: 'Booked already', finalTime: '2026-08-11T14:00' }, calls });

    const before = xrpcCalls.length;
    const out = JSON.parse(await callTool('delete_poll', { rkey: 'fin1' }, AUTH));
    assert.equal(out.ok, true);
    assert.ok(xrpcCalls.length > before, 'must have issued a deleteRecord');
  });

  it('requires auth, and never touches the network without it', async () => {
    let touched = false;
    fetchImpl = async () => { touched = true; return { ok: true, json: async () => ({}) }; };

    await assert.rejects(() => callTool('delete_poll', { rkey: 'x' }, null), /AUTH_REQUIRED/);
    await assert.rejects(() => callTool('delete_poll', { rkey: 'x' }, { did: 'did:plc:creator' }), /AUTH_REQUIRED/);
    assert.equal(touched, false);
  });

  it('requires an rkey', async () => {
    fetchImpl = async () => { throw new Error('should not fetch'); };
    await assert.rejects(() => callTool('delete_poll', {}, AUTH), /rkey is required/);
  });
});
