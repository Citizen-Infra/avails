// server/src/mcp/oauth.js
import { Router } from 'express';
import crypto from 'node:crypto';
import { getClient as getOAuthClient } from '../routes/auth.js';
import { createSession } from '../lib/sessionStore.js';
import { registerClient, getClient, bindClientDid } from './clients.js';
import { signToken } from './jwt.js';

const router = Router();

// Pending auth flows: state → { mcpClientId, clientId, redirectUri, createdAt }
const pendingAuths = new Map();

// Issued auth codes: code → { mcpClientId, clientId, did, handle, createdAt }
const authCodes = new Map();

function getJwtSecret() {
  return process.env.MCP_JWT_SECRET || process.env.SESSION_SECRET;
}

function getExternalBase() {
  return process.env.CLIENT_URL || 'http://localhost:5173';
}

// POST /mcp/register — dynamic MCP client registration
router.post('/register', async (req, res) => {
  try {
    const { client_id, redirect_uri, dpop_jwk } = req.body;
    if (!client_id || !redirect_uri) {
      return res.status(400).json({ error: 'client_id and redirect_uri required' });
    }

    const result = registerClient(client_id, redirect_uri, dpop_jwk ? JSON.stringify(dpop_jwk) : '');
    console.log(`MCP client registered: ${result.mcpClientId} (${client_id})`);
    res.json({
      mcp_client_id: result.mcpClientId,
      client_id: result.clientId,
    });
  } catch (err) {
    console.error('MCP register error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /mcp/authorize — start ATProto OAuth, redirect user to auth server
router.get('/authorize', async (req, res) => {
  try {
    const { mcp_client_id, handle } = req.query;
    if (!mcp_client_id || !handle) {
      return res.status(400).json({ error: 'mcp_client_id and handle required' });
    }

    const mcpClient = getClient(mcp_client_id);
    if (!mcpClient) {
      return res.status(404).json({ error: 'MCP client not found. Register first.' });
    }

    const oauthClient = await getOAuthClient();
    const state = crypto.randomBytes(16).toString('hex');

    pendingAuths.set(state, {
      mcpClientId: mcp_client_id,
      clientId: mcpClient.clientId,
      redirectUri: mcpClient.redirectUri,
      createdAt: Date.now(),
    });

    // Clean up old pending auths (older than 10 minutes)
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, val] of pendingAuths) {
      if (val.createdAt < tenMinAgo) pendingAuths.delete(key);
    }

    const authUrl = await oauthClient.authorize(handle, {
      state,
      scope: 'atproto transition:generic',
    });

    res.redirect(authUrl.toString());
  } catch (err) {
    console.error('MCP authorize error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /mcp/callback — ATProto OAuth callback, issue auth code to MCP client
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
    const state = req.query.state;
    const pending = pendingAuths.get(state);
    if (!pending) {
      return res.status(400).json({ error: 'Invalid or expired OAuth state' });
    }
    pendingAuths.delete(state);

    // Bind DID to MCP client
    bindClientDid(pending.mcpClientId, did);

    // Issue one-time auth code
    const code = crypto.randomBytes(32).toString('hex');
    authCodes.set(code, {
      mcpClientId: pending.mcpClientId,
      clientId: pending.clientId,
      did,
      handle,
      createdAt: Date.now(),
    });

    // Clean up old auth codes (older than 5 minutes)
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    for (const [key, val] of authCodes) {
      if (val.createdAt < fiveMinAgo) authCodes.delete(key);
    }

    // Redirect to MCP client with auth code
    const redirectUrl = new URL(pending.redirectUri);
    redirectUrl.searchParams.set('code', code);
    redirectUrl.searchParams.set('state', state);
    res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error('MCP callback error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /mcp/token — exchange auth code for JWT-wrapped MCP token
router.post('/token', async (req, res) => {
  try {
    const { code, mcp_client_id } = req.body;
    if (!code || !mcp_client_id) {
      return res.status(400).json({ error: 'code and mcp_client_id required' });
    }

    const authCode = authCodes.get(code);
    if (!authCode) {
      return res.status(400).json({ error: 'Invalid or expired authorization code' });
    }
    authCodes.delete(code);

    if (authCode.mcpClientId !== mcp_client_id) {
      return res.status(403).json({ error: 'Client ID mismatch' });
    }

    const secret = getJwtSecret();
    const token = signToken(secret, {
      sub: authCode.did,
      iss: getExternalBase(),
      aud: authCode.clientId,
      client_id: authCode.clientId,
      mcp_client_id: authCode.mcpClientId,
      handle: authCode.handle,
    }, 24 * 60 * 60); // 24 hour expiry

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 24 * 60 * 60,
      did: authCode.did,
      handle: authCode.handle,
    });
  } catch (err) {
    console.error('MCP token error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
