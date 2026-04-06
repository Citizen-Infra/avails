import { Router } from 'express';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { JoseKey } from '@atproto/jwk-jose';
import { createSession, deleteSession, getSession, sessions, restoreOAuthSessions, cleanupExpiredSessions } from '../lib/sessionStore.js';
import { registerStore, markDirty } from '../lib/persistence.js';
import { tryMcpCallback } from '../mcp/oauth.js';

const router = Router();

// In-memory stores for the ATProto OAuth client
// stateStore: temporary OAuth flow state (CSRF protection), keyed by random state string
const oauthStateStore = new Map();
// oauthSessionStore: ATProto session data keyed by DID — managed by the OAuth client itself
// Persisted to disk so sessions survive deploys
export const oauthSessionStore = new Map();
registerStore('oauth-sessions', oauthSessionStore);

// Also persist the app-level session map (cookie → {did, handle, createdAt})
// Note: we can't persist the live oauthSession object, but we store the DID
// and rebuild the live session via client.restore(did) on startup
registerStore('app-sessions', sessions);

// Simple in-process lock — prevents concurrent token refreshes for the same DID
function createLock() {
  const locks = new Map(); // key → Promise
  return async (key, fn) => {
    while (locks.has(key)) {
      await locks.get(key);
    }
    const promise = fn();
    locks.set(key, promise.finally(() => locks.delete(key)));
    return promise;
  };
}

const requestLock = createLock();

// Build the OAuth client once at module load (lazy init on first request)
let _client = null;
export async function getClient() {
  if (_client) return _client;

  const clientId = process.env.ATPROTO_CLIENT_ID;
  const redirectUri = process.env.ATPROTO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error('ATPROTO_CLIENT_ID and ATPROTO_REDIRECT_URI must be set');
  }

  // Derive base URL from the client ID URL (e.g. https://avails.zhgnv.com)
  const clientUri = new URL(clientId).origin;

  // Load the signing key from env var. Generate one with:
  // node --input-type=module -e "import{generateKeyPair,exportJWK}from'jose';import crypto from'crypto';const{privateKey}=await generateKeyPair('ES256',{extractable:true});const j=await exportJWK(privateKey);j.kid=crypto.randomUUID();j.alg='ES256';j.use='sig';console.log(JSON.stringify(j))"
  if (!process.env.ATPROTO_PRIVATE_KEY) {
    throw new Error('ATPROTO_PRIVATE_KEY env var required (base64-encoded JSON ES256 JWK)');
  }
  // Base64-decode the key to avoid Railway env var escaping issues with JSON
  let keyJson;
  try {
    keyJson = Buffer.from(process.env.ATPROTO_PRIVATE_KEY, 'base64').toString('utf8');
    JSON.parse(keyJson); // validate it's valid JSON
  } catch {
    // Fall back to treating it as raw JSON (for local dev)
    keyJson = process.env.ATPROTO_PRIVATE_KEY;
  }
  const key = await JoseKey.fromImportable(keyJson);

  _client = new NodeOAuthClient({
    clientMetadata: {
      client_id: clientId,
      client_name: 'Avails',
      client_uri: clientUri,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'web',
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_signing_alg: 'ES256',
      dpop_bound_access_tokens: true,
      scope: 'atproto repo:chat.avails.scheduling.poll repo:chat.avails.scheduling.response',
      jwks_uri: `${clientUri}/api/auth/jwks.json`,
    },

    keyset: [key],

    requestLock,

    stateStore: {
      async set(key, value) { oauthStateStore.set(key, value); },
      async get(key) { return oauthStateStore.get(key); },
      async del(key) { oauthStateStore.delete(key); },
    },

    sessionStore: {
      async set(sub, value) { oauthSessionStore.set(sub, value); markDirty('oauth-sessions'); },
      async get(sub) { return oauthSessionStore.get(sub); },
      async del(sub) { oauthSessionStore.delete(sub); markDirty('oauth-sessions'); },
    },
  });

  return _client;
}

// Expose client metadata at the URL declared as client_id
router.get('/client-metadata.json', async (req, res, next) => {
  try {
    const client = await getClient();
    res.json(client.clientMetadata);
  } catch (err) {
    next(err);
  }
});

// Expose JWKS so ATProto servers can verify our private_key_jwt assertions
router.get('/jwks.json', async (req, res, next) => {
  try {
    const client = await getClient();
    res.json(client.jwks);
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/login?handle=user.bsky.social
router.get('/login', async (req, res, next) => {
  try {
    const handle = req.query.handle;
    if (!handle) return res.status(400).json({ error: 'handle query param required' });

    const client = await getClient();

    const ac = new AbortController();
    req.on('close', () => ac.abort());

    const url = await client.authorize(handle, {
      signal: ac.signal,
      scope: 'atproto repo:chat.avails.scheduling.poll repo:chat.avails.scheduling.response',
    });

    res.redirect(url.toString());
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/callback
router.get('/callback', async (req, res, next) => {
  try {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const client = await getClient();

    const result = await client.callback(params);
    const session = result.session;

    // The DID might be on .sub or .did depending on SDK version
    const did = session.did || session.sub;

    // Resolve the handle from the DID via PLC directory
    let handle = did;
    try {
      const plcRes = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
      if (plcRes.ok) {
        const plcDoc = await plcRes.json();
        const aka = plcDoc.alsoKnownAs?.find(a => a.startsWith('at://'));
        if (aka) handle = aka.replace('at://', '');
      }
    } catch {
      // Handle resolution failed — fall back to DID
    }

    const sessionId = createSession(session, did, handle);

    // Check if this callback is from an MCP OAuth flow
    const callbackState = params.get('state');
    const resultState = result.state;
    const mcpRedirect = tryMcpCallback(resultState, session, did, handle)
      || tryMcpCallback(callbackState, session, did, handle);
    if (mcpRedirect) {
      return res.type('html').send(`<!DOCTYPE html>
<html>
<head><title>Avails — Connected</title>
<meta http-equiv="refresh" content="2;url=${mcpRedirect.replace(/"/g, '&quot;')}">
<style>body{font-family:system-ui;max-width:400px;margin:100px auto;padding:20px;text-align:center}
.check{font-size:48px;margin-bottom:16px}
h2{color:#1a1a1a;margin-bottom:8px}
p{color:#6b6560}</style>
</head>
<body>
<div class="check">&#x2705;</div>
<h2>Connected to Avails</h2>
<p>Signed in as <strong>${handle}</strong></p>
<p>Redirecting back to your AI assistant...</p>
</body>
</html>`);
    }

    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('avails_session', sessionId, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    res.redirect(clientUrl + '/');
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/session
router.get('/session', (req, res) => {
  const sessionId = req.cookies?.avails_session;
  if (!sessionId) return res.json({ authenticated: false });

  const session = getSession(sessionId);
  if (!session) return res.json({ authenticated: false });

  res.json({
    authenticated: true,
    did: session.did,
    handle: session.handle,
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const sessionId = req.cookies?.avails_session;
  if (sessionId) {
    deleteSession(sessionId);
  }
  res.clearCookie('avails_session');
  res.json({ ok: true });
});

export default router;
