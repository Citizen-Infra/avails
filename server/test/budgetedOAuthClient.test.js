// Exercise the installed SDK with ephemeral keys and .invalid mock endpoints.
// No application startup, credentials, DNS, PDS writes or real OAuth accounts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JoseKey } from '@atproto/jwk-jose';
import { BudgetedOAuthClient } from '../src/lib/budgetedOAuthClient.js';
import { OAUTH_INPUT_LIMITS, OAuthInputBudgetError } from '../src/lib/oauthInputBudget.js';
import { ATPROTO_SCOPE } from '../src/lib/oauthScopes.js';

const pds = 'https://pds.example.invalid';
const issuer = 'https://issuer.example.invalid';
const did = 'did:plc:abcdefghijklmnopqrstuvwx';
const tokenPath = '/xrpc/deliberately-not-a-record-request';
const response = (value, init = {}) => new Response(JSON.stringify(value), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });

function hasBudgetError(error) {
  for (let current = error; current; current = current.cause) {
    if (current instanceof OAuthInputBudgetError) return true;
  }
  return false;
}

async function fixture(options = {}) {
  const key = await JoseKey.generate(['ES256'], 'synthetic-signing-key');
  const states = new Map(), sessions = new Map(), calls = [];
  let tokenCalls = 0;
  const modes = { nonce: false, invalidRecordToken: false, large: undefined, ...options };
  const fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.text() : undefined;
    calls.push({ url: request.url, method: request.method, body, proof: request.headers.get('DPoP'), auth: request.headers.get('Authorization') });
    if (request.url === `${pds}/.well-known/oauth-protected-resource`) {
      return response({ resource: pds, authorization_servers: [issuer], scopes_supported: Array.from({ length: 128 }, (_, i) => `synthetic-scope-${i}`), ...(modes.large === 'resource' ? { scopes_supported: Array(1025).fill(0) } : {}) });
    }
    if (request.url === `${issuer}/.well-known/oauth-authorization-server`) {
      return response({
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}${tokenPath}`,
        pushed_authorization_request_endpoint: `${issuer}/arbitrary-par-endpoint`,
        token_endpoint_auth_methods_supported: ['private_key_jwt'],
        token_endpoint_auth_signing_alg_values_supported: ['ES256'],
        dpop_signing_alg_values_supported: ['ES256'], response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: true,
        ...(modes.large === 'issuer' ? { scopes_supported: Array(1025).fill(0) } : {}),
      });
    }
    if (request.url === `${issuer}/arbitrary-par-endpoint`) {
      assert.equal(request.method, 'POST');
      return response({ request_uri: 'urn:ietf:params:oauth:request_uri:synthetic', expires_in: 60 });
    }
    if (request.url === `https://plc.directory/${encodeURIComponent(did)}` || request.url === 'https://identity.example.invalid/.well-known/did.json') {
      return response({
        '@context': 'https://www.w3.org/ns/did/v1', id: url.hostname === 'plc.directory' ? did : 'did:web:identity.example.invalid',
        alsoKnownAs: ['did', 'web'].includes(modes.large) ? Array(1025).fill(0) : ['at://fixture.example.invalid'],
        service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: pds }],
      });
    }
    if (request.url === `${issuer}${tokenPath}`) {
      tokenCalls++;
      assert.equal(request.method, 'POST');
      assert.ok(request.headers.get('DPoP'));
      if (modes.nonce && tokenCalls === 1) {
        return response({ error: 'use_dpop_nonce' }, { status: 400, headers: { 'DPoP-Nonce': 'synthetic-provider-nonce' } });
      }
      return response({
        token_type: 'DPoP', sub: did, scope: ATPROTO_SCOPE, expires_in: 3600,
        access_token: `synthetic-access-${tokenCalls}`, refresh_token: `synthetic-refresh-${tokenCalls}`,
        ...(modes.large === 'token' ? { authorization_details: Array(1025).fill(0) } : {}),
      });
    }
    if (url.origin === pds && url.pathname.startsWith('/xrpc/')) {
      assert.ok(request.headers.get('DPoP'));
      assert.ok(request.headers.get('Authorization')?.startsWith('DPoP '));
      if (modes.invalidRecordToken && request.headers.get('Authorization') === 'DPoP synthetic-access-1') {
        return response({ error: 'InvalidToken' }, { status: 401, headers: { 'www-authenticate': 'DPoP error="invalid_token"' } });
      }
      // Larger than BOTH the control-plane byte and collection limits.
      return response({ records: Array.from({ length: 1025 }, (_, i) => ({ value: 'x'.repeat(512), rkey: String(i) })) });
    }
    assert.fail(`Unexpected mock request: ${url.origin}${url.pathname}`);
  };
  const store = map => ({ async get(key) { return map.get(key); }, async set(key, value) { map.set(key, value); }, async del(key) { map.delete(key); } });
  const createClient = () => new BudgetedOAuthClient({
    fetch,
    clientMetadata: {
      client_id: 'https://avails.example.invalid/api/auth/client-metadata-v4.json',
      redirect_uris: ['https://avails.example.invalid/api/auth/callback'],
      client_name: 'Synthetic Avails', client_uri: 'https://avails.example.invalid',
      application_type: 'web', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_signing_alg: 'ES256',
      dpop_bound_access_tokens: true, scope: ATPROTO_SCOPE,
      jwks_uri: 'https://avails.example.invalid/api/auth/jwks.json',
    },
    keyset: [key], stateStore: store(states), sessionStore: store(sessions),
    requestLock: async (key, fn) => fn(), // Sequential fixtures only.
  });
  const client = createClient();
  async function login() {
    const authUrl = await client.authorize(pds, { state: 'synthetic-app-state', scope: ATPROTO_SCOPE });
    assert.equal(authUrl.origin, issuer);
    const state = [...states.keys()][0];
    return client.callback(new URLSearchParams({ state, iss: issuer, code: 'synthetic-code' }));
  }
  return { client, createClient, login, modes, calls, states, sessions, tokenCalls: () => tokenCalls };
}

describe('budgeted OAuth client boundary', () => {
  it('is the client instantiated by the application without changing scopes or metadata version', () => {
    const source = readFileSync(new URL('../src/routes/auth.js', import.meta.url), 'utf8');
    assert.match(source, /new BudgetedOAuthClient\(/);
    assert.match(source, /client-metadata-v4\.json/);
    assert.match(source, /scope: ATPROTO_SCOPE/);
  });

  it('preserves PAR, PKCE, callback state, DPoP nonce retry and persisted session data', { timeout: 5000 }, async () => {
    const f = await fixture({ nonce: true });
    const { session, state } = await f.login();
    assert.equal(state, 'synthetic-app-state');
    assert.equal(session.did, did);
    assert.equal(f.states.size, 0);
    const par = new URLSearchParams(f.calls.find(call => call.url.endsWith('/arbitrary-par-endpoint')).body);
    assert.equal(par.get('code_challenge_method'), 'S256');
    assert.ok(par.get('code_challenge'));
    assert.equal(par.get('scope'), ATPROTO_SCOPE);
    const tokens = f.calls.filter(call => call.url === `${issuer}${tokenPath}`);
    assert.equal(tokens.length, 2, 'Only the SDK nonce retry, not an adapter retry');
    assert.notEqual(tokens[0].proof, tokens[1].proof);
    assert.ok(new URLSearchParams(tokens[1].body).get('code_verifier'));
    const persisted = JSON.parse(JSON.stringify(f.sessions.get(did)));
    assert.equal(persisted.tokenSet.sub, did);
    assert.equal(persisted.tokenSet.scope, ATPROTO_SCOPE);
    assert.equal(persisted.tokenSet.access_token, 'synthetic-access-2');
    f.sessions.set(did, persisted);
    const restored = await f.createClient().restore(did, false);
    assert.equal(restored.did, did);
    assert.equal(f.tokenCalls(), 2, 'Nonexpired restore should not refresh');
  });

  it('keeps record lists above the OAuth byte/collection caps unchanged', { timeout: 5000 }, async () => {
    const f = await fixture();
    const { session } = await f.login();
    const result = await session.fetchHandler('/xrpc/com.atproto.repo.listRecords');
    const text = await result.text();
    assert.ok(Buffer.byteLength(text) > OAUTH_INPUT_LIMITS.bytes);
    assert.equal(JSON.parse(text).records.length, 1025);
    assert.equal(f.calls.filter(call => call.url.startsWith(`${pds}/xrpc/`)).length, 1);
  });

  it('retains forced refresh and persists the replacement token through a fresh client', { timeout: 5000 }, async () => {
    const f = await fixture();
    await f.login();
    f.sessions.set(did, JSON.parse(JSON.stringify(f.sessions.get(did))));
    const restored = await f.createClient().restore(did, true);
    assert.equal(restored.did, did);
    assert.equal(f.tokenCalls(), 2);
    assert.equal(f.sessions.get(did).tokenSet.access_token, 'synthetic-access-2');
    const tokens = f.calls.filter(call => call.url === `${issuer}${tokenPath}`);
    assert.equal(new URLSearchParams(tokens[1].body).get('grant_type'), 'refresh_token');
  });

  it('retains SDK invalid-token refresh/retry for PDS requests', { timeout: 5000 }, async () => {
    const f = await fixture({ invalidRecordToken: true });
    const { session } = await f.login();
    const result = await session.fetchHandler('/xrpc/com.atproto.repo.listRecords');
    assert.equal(result.status, 200);
    assert.equal((await result.json()).records.length, 1025);
    assert.equal(f.tokenCalls(), 2);
    assert.equal(f.calls.filter(call => call.url.startsWith(`${pds}/xrpc/`)).length, 2);
  });

  for (const kind of ['resource', 'issuer', 'did', 'web', 'token']) {
    it(`rejects oversized ${kind} data through the installed SDK, before Zod issue buildup`, { timeout: 5000 }, async () => {
      const f = await fixture({ large: kind });
      if (kind === 'did') await assert.rejects(f.client.didResolver.resolve(did), hasBudgetError);
      else if (kind === 'web') await assert.rejects(f.client.didResolver.resolve('did:web:identity.example.invalid'), hasBudgetError);
      else if (kind === 'issuer') await assert.rejects(f.client.oauthResolver.getAuthorizationServerMetadata(issuer), hasBudgetError);
      else if (kind === 'resource') await assert.rejects(f.client.oauthResolver.getResourceServerMetadata(pds), hasBudgetError);
      else await assert.rejects(f.login(), hasBudgetError);
    });
  }

  it('does not let a PDS request bypass the budget on its token refresh', { timeout: 5000 }, async () => {
    const f = await fixture({ invalidRecordToken: true });
    const { session } = await f.login();
    f.modes.large = 'token';
    const result = await session.fetchHandler('/xrpc/com.atproto.repo.listRecords');
    assert.equal(result.status, 401, 'Keep the SDK response when refresh cannot complete safely');
    assert.equal(f.tokenCalls(), 2);
    assert.equal(f.calls.filter(call => call.url.startsWith(`${pds}/xrpc/`)).length, 1, 'No PDS replay after failed refresh');
    assert.equal(f.sessions.get(did).tokenSet.access_token, 'synthetic-access-1');
  });
});
