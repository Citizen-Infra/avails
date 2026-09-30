import { after, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

process.env.CLIENT_URL = 'https://avails.example';
process.env.MCP_JWT_SECRET = 'test-only-signing-secret';

let savedClients;
let failSave = false;
let capturedState;
mock.module('../src/lib/persistence.js', {
  namedExports: {
    registerStore: (name, map) => { if (name === 'mcp-clients') savedClients = map; },
    markDirty: () => {},
    saveNow: async () => {},
    saveStoreNow: async () => { if (failSave) throw new Error('disk unavailable'); },
  },
});
mock.module('../src/routes/auth.js', {
  namedExports: {
    getClient: async () => ({
      authorize: async (_handle, options) => {
        capturedState = options.state;
        return 'https://pds.example/authorize';
      },
    }),
  },
});

const { verifyToken } = await import('../src/mcp/jwt.js');
const { tryMcpCallback, default: oauthRouter } = await import('../src/mcp/oauth.js');
const app = express();
app.use(express.json());
app.use('/mcp', oauthRouter);
const server = app.listen(0);
after(() => server.close());
const base = `http://127.0.0.1:${server.address().port}`;

async function token(body) {
  const response = await fetch(`${base}/mcp/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  return { status: response.status, body: await response.json() };
}

async function authorize() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const registration = await (await fetch(`${base}/mcp/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:9999/callback'] }),
  })).json();
  const params = new URLSearchParams({
    response_type: 'code', client_id: registration.client_id,
    redirect_uri: 'http://127.0.0.1:9999/callback', state: 'state',
    code_challenge: challenge, handle: 'someone.test',
  });
  await fetch(`${base}/mcp/authorize?${params}`, { redirect: 'manual' });
  const redirect = await tryMcpCallback(capturedState, {}, 'did:plc:someone', 'someone.test');
  const code = new URL(redirect).searchParams.get('code');
  return { client_id: registration.client_id, code, verifier };
}

describe('MCP refresh token lifecycle', () => {
  it('issues a durable verifier, rotates on refresh and rejects replay, wrong client and expiry', async () => {
    const { client_id, code, verifier } = await authorize();
    const first = await token({ grant_type: 'authorization_code', client_id, code, code_verifier: verifier });
    assert.equal(first.status, 200);
    assert.ok(first.body.refresh_token);
    assert.ok(savedClients.get(client_id).refreshTokenHash);
    assert.ok(!JSON.stringify(savedClients.get(client_id)).includes(first.body.refresh_token),
      'only a hash belongs on the persistent volume');
    assert.equal(verifyToken(process.env.MCP_JWT_SECRET, first.body.access_token).sub, 'did:plc:someone');

    const other = await authorize();
    const wrong = await token({ grant_type: 'refresh_token', client_id: other.client_id, refresh_token: first.body.refresh_token });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error, 'invalid_grant');

    const second = await token({ grant_type: 'refresh_token', client_id, refresh_token: first.body.refresh_token });
    assert.equal(second.status, 200);
    assert.notEqual(second.body.refresh_token, first.body.refresh_token);
    assert.equal(verifyToken(process.env.MCP_JWT_SECRET, second.body.access_token).sub, 'did:plc:someone');
    assert.equal((await token({ grant_type: 'refresh_token', client_id, refresh_token: first.body.refresh_token })).status, 400);

    // A fresh process reconstructs the map from the volume; the verifier is
    // sufficient to refresh without another browser sign-in.
    const persisted = JSON.parse(JSON.stringify(savedClients.get(client_id)));
    savedClients.delete(client_id);
    savedClients.set(client_id, persisted);
    const third = await token({ grant_type: 'refresh_token', client_id, refresh_token: second.body.refresh_token });
    assert.equal(third.status, 200);

    savedClients.get(client_id).refreshTokenExpiresAt = Date.now() - 1;
    assert.equal((await token({ grant_type: 'refresh_token', client_id, refresh_token: third.body.refresh_token })).status, 400);
  });

  it('does not disclose an unpersisted refresh token when the volume write fails', async () => {
    const { client_id, code, verifier } = await authorize();
    failSave = true;
    const result = await token({ grant_type: 'authorization_code', client_id, code, code_verifier: verifier });
    failSave = false;
    assert.equal(result.status, 500);
    assert.equal(result.body.access_token, undefined);
    assert.equal(result.body.refresh_token, undefined);
    assert.equal(savedClients.get(client_id).refreshTokenHash, undefined);
  });

  it('keeps the prior refresh token usable if rotating it cannot be persisted', async () => {
    const { client_id, code, verifier } = await authorize();
    const first = await token({ grant_type: 'authorization_code', client_id, code, code_verifier: verifier });
    failSave = true;
    const failed = await token({ grant_type: 'refresh_token', client_id, refresh_token: first.body.refresh_token });
    failSave = false;
    assert.equal(failed.status, 500);
    assert.equal(failed.body.refresh_token, undefined);
    assert.equal((await token({ grant_type: 'refresh_token', client_id, refresh_token: first.body.refresh_token })).status, 200);
  });
});
