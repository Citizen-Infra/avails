// The DID binding an MCP client acquires at OAuth completion is what
// extractAuthContext compares every later token against. It used to be written
// only by the 30s persistence tick, so a restart before the next flush restored
// the client with `did: null` and every later request from that client was
// silently treated as unauthenticated — no log, and the client reporting "token
// expired" for a token still valid for another 22 hours.
import { describe, it, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

let saveNowCalls = 0;
mock.module('../src/lib/persistence.js', {
  namedExports: {
    saveNow: async () => { saveNowCalls++; },
    registerStore: () => {},
    markDirty: () => {},
    startPersistence: async () => {},
  },
});

// The route hands its internal state to the ATProto client's authorize(); that
// is the only way to observe it, since pendingAuths is module-private.
let capturedState = null;
mock.module('../src/routes/auth.js', {
  namedExports: {
    getClient: async () => ({
      authorize: async (_handle, opts) => { capturedState = opts.state; return 'https://pds.example/authorize'; },
      restore: async () => null,
    }),
  },
});

const { getClient: getMcpClient } = await import('../src/mcp/clients.js');
const oauthRouter = (await import('../src/mcp/oauth.js')).default;
const { tryMcpCallback } = await import('../src/mcp/oauth.js');

const app = express();
app.use(express.json());
app.use('/mcp', oauthRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

describe('MCP DID binding durability', () => {
  it('flushes the binding to disk before handing back an auth code', async () => {
    const reg = await (await fetch(`${base}/mcp/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:9999/cb'], client_name: 'test client' }),
    })).json();
    assert.ok(reg.client_id, 'registration must return a client_id');

    const qs = new URLSearchParams({
      response_type: 'code',
      client_id: reg.client_id,
      redirect_uri: 'http://127.0.0.1:9999/cb',
      state: 'client-state',
      code_challenge: 'challenge',
      handle: 'someone.test',
    });
    await fetch(`${base}/mcp/authorize?${qs}`, { redirect: 'manual' });
    assert.ok(capturedState, 'the authorize route must have started an ATProto flow');

    saveNowCalls = 0;
    const redirect = await tryMcpCallback(capturedState, { fake: 'session' }, 'did:plc:someone', 'someone.test');

    assert.ok(redirect, 'a pending MCP flow must produce a redirect');
    assert.equal(getMcpClient(reg.client_id).did, 'did:plc:someone', 'the DID must be bound');
    assert.equal(saveNowCalls, 1,
      'the binding must be persisted immediately, not left to the 30s tick');
  });

  it('does nothing and persists nothing for a state that is not an MCP flow', async () => {
    saveNowCalls = 0;
    const out = await tryMcpCallback('not-a-pending-state', {}, 'did:plc:x', 'x.test');
    assert.equal(out, null);
    assert.equal(saveNowCalls, 0);
  });
});
