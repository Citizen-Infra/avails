// server/src/mcp/oauth.js
import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import { getClient as getOAuthClient } from '../routes/auth.js';
import { createSession } from '../lib/sessionStore.js';
import { registerClient, getClient, bindClientDid } from './clients.js';
import { signToken } from './jwt.js';

const router = Router();

// Pending auth flows: state → { mcpClientId, redirectUri, codeChallenge, clientState, createdAt }
const pendingAuths = new Map();

// Issued auth codes: code → { mcpClientId, did, handle, codeChallenge, redirectUri, createdAt }
const authCodes = new Map();

function getJwtSecret() {
  return process.env.MCP_JWT_SECRET || process.env.SESSION_SECRET;
}

function getExternalBase() {
  return process.env.CLIENT_URL || 'http://localhost:5173';
}

// --- Well-known endpoints ---

// RFC 9728 — Protected Resource Metadata
router.get('/.well-known/oauth-protected-resource', (req, res) => {
  const base = getExternalBase();
  res.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
  });
});

// RFC 8414 — Authorization Server Metadata
router.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = getExternalBase();
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/mcp/authorize`,
    token_endpoint: `${base}/mcp/token`,
    registration_endpoint: `${base}/mcp/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['atproto'],
  });
});

// --- RFC 7591 Dynamic Client Registration ---

router.post('/register', (req, res) => {
  try {
    const { redirect_uris, client_name, grant_types, response_types, token_endpoint_auth_method, application_type } = req.body;

    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return res.status(400).json({ error: 'redirect_uris required (array with at least one URI)' });
    }

    const result = registerClient({
      redirect_uris,
      client_name: client_name || 'Unknown Client',
      grant_types: grant_types || ['authorization_code'],
      response_types: response_types || ['code'],
      token_endpoint_auth_method: token_endpoint_auth_method || 'none',
      application_type: application_type || 'native',
    });

    console.log(`MCP client registered: ${result.client_id} (${result.client_name})`);

    res.status(201).json({
      client_id: result.client_id,
      redirect_uris: result.redirect_uris,
      client_name: result.client_name,
      grant_types: result.grant_types,
      response_types: result.response_types,
      token_endpoint_auth_method: result.token_endpoint_auth_method,
    });
  } catch (err) {
    console.error('MCP register error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- OAuth Authorize ---

router.get('/authorize', async (req, res) => {
  try {
    const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, resource, handle } = req.query;

    // Validate required OAuth params
    if (!response_type || !client_id || !redirect_uri || !state || !code_challenge) {
      return res.status(400).json({ error: 'Missing required OAuth parameters (response_type, client_id, redirect_uri, state, code_challenge)' });
    }

    if (response_type !== 'code') {
      return res.status(400).json({ error: 'Only response_type=code is supported' });
    }

    if (code_challenge_method && code_challenge_method !== 'S256') {
      return res.status(400).json({ error: 'Only code_challenge_method=S256 is supported' });
    }

    // Verify client is registered
    const mcpClient = getClient(client_id);
    if (!mcpClient) {
      return res.status(404).json({ error: 'Client not found. Register first via POST /mcp/register.' });
    }

    // Verify redirect_uri matches registration
    if (!mcpClient.redirect_uris.includes(redirect_uri)) {
      return res.status(400).json({ error: 'redirect_uri does not match registered URIs' });
    }

    // If no handle provided, serve the Bluesky handle form
    if (!handle) {
      const formHtml = buildHandleForm({ response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method: code_challenge_method || 'S256', scope: scope || '', resource: resource || '' });
      return res.type('html').send(formHtml);
    }

    // Handle is present — start ATProto OAuth flow
    const oauthClient = await getOAuthClient();
    const internalState = crypto.randomBytes(16).toString('hex');

    pendingAuths.set(internalState, {
      mcpClientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      clientState: state,
      createdAt: Date.now(),
    });

    // Clean up old pending auths (older than 10 minutes)
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, val] of pendingAuths) {
      if (val.createdAt < tenMinAgo) pendingAuths.delete(key);
    }

    const authUrl = await oauthClient.authorize(handle, {
      state: internalState,
      scope: 'atproto transition:generic',
    });

    res.redirect(authUrl.toString());
  } catch (err) {
    console.error('MCP authorize error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- ATProto OAuth Callback ---

router.get('/callback', async (req, res) => {
  try {
    const oauthClient = await getOAuthClient();
    const params = new URLSearchParams(req.query);

    const { session: oauthSession } = await oauthClient.callback(params);
    const did = oauthSession.did || oauthSession.sub;

    // Resolve handle
    let handle = did;
    try {
      const plcRes = await fetch(`https://plc.directory/${did}`);
      if (plcRes.ok) {
        const doc = await plcRes.json();
        handle = doc.alsoKnownAs?.[0]?.replace('at://', '') || did;
      }
    } catch (_) { /* fall back to DID */ }

    // Store session to Railway volume (same as web UI) for response persistence
    createSession(oauthSession, did, handle);

    // Find the pending auth by state
    const internalState = req.query.state;
    const pending = pendingAuths.get(internalState);
    if (!pending) {
      return res.status(400).json({ error: 'Invalid or expired OAuth state' });
    }
    pendingAuths.delete(internalState);

    // Bind DID to MCP client
    bindClientDid(pending.mcpClientId, did);

    // Issue one-time auth code
    const code = crypto.randomBytes(32).toString('hex');
    authCodes.set(code, {
      mcpClientId: pending.mcpClientId,
      did,
      handle,
      codeChallenge: pending.codeChallenge,
      redirectUri: pending.redirectUri,
      createdAt: Date.now(),
    });

    // Clean up old auth codes (older than 5 minutes)
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    for (const [key, val] of authCodes) {
      if (val.createdAt < fiveMinAgo) authCodes.delete(key);
    }

    // Redirect to MCP client with auth code + original client state
    const redirectUrl = new URL(pending.redirectUri);
    redirectUrl.searchParams.set('code', code);
    redirectUrl.searchParams.set('state', pending.clientState);
    res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error('MCP callback error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Token Exchange ---

router.post('/token', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { grant_type, code, client_id, redirect_uri, code_verifier, resource, refresh_token } = req.body;

    if (grant_type === 'refresh_token') {
      // TODO: implement refresh token support
      return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'refresh_token grant not yet implemented' });
    }

    if (grant_type !== 'authorization_code') {
      return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only authorization_code is supported' });
    }

    if (!code || !client_id || !code_verifier) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'code, client_id, and code_verifier required' });
    }

    const authCode = authCodes.get(code);
    if (!authCode) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
    }
    authCodes.delete(code);

    // Verify client_id matches
    if (authCode.mcpClientId !== client_id) {
      return res.status(403).json({ error: 'invalid_client', error_description: 'Client ID mismatch' });
    }

    // Verify redirect_uri matches
    if (redirect_uri && authCode.redirectUri !== redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    }

    // PKCE verification: SHA256(code_verifier) must equal stored code_challenge
    const expected = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (expected !== authCode.codeChallenge) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }

    const base = getExternalBase();
    const secret = getJwtSecret();
    const token = signToken(secret, {
      sub: authCode.did,
      iss: base,
      aud: base,
      client_id: client_id,
      mcp_client_id: client_id,
      handle: authCode.handle,
    }, 24 * 60 * 60); // 24 hour expiry

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 24 * 60 * 60,
    });
  } catch (err) {
    console.error('MCP token error:', err);
    res.status(500).json({ error: 'server_error', error_description: err.message });
  }
});

// --- Handle Form HTML ---

function buildHandleForm({ response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, resource }) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html>
<head><title>Sign in to Avails</title>
<style>body{font-family:system-ui;max-width:400px;margin:100px auto;padding:20px}
input{width:100%;padding:8px;margin:8px 0;box-sizing:border-box;border:1px solid #e8e5df;border-radius:4px}
button{background:#0d9488;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;width:100%}
button:hover{background:#0b7f74}</style>
</head>
<body>
<h2>Sign in to Avails</h2>
<p>Enter your Bluesky handle to continue</p>
<form method="GET" action="/mcp/authorize">
  <input type="hidden" name="response_type" value="${esc(response_type)}">
  <input type="hidden" name="client_id" value="${esc(client_id)}">
  <input type="hidden" name="redirect_uri" value="${esc(redirect_uri)}">
  <input type="hidden" name="state" value="${esc(state)}">
  <input type="hidden" name="code_challenge" value="${esc(code_challenge)}">
  <input type="hidden" name="code_challenge_method" value="${esc(code_challenge_method)}">
  <input type="hidden" name="scope" value="${esc(scope)}">
  <input type="hidden" name="resource" value="${esc(resource)}">
  <input type="text" name="handle" placeholder="yourname.bsky.social" required autofocus>
  <button type="submit">Sign in with Bluesky</button>
</form>
</body>
</html>`;
}

export default router;
