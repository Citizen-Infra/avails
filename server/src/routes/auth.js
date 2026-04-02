import { Router } from 'express';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { JoseKey } from '@atproto/jwk-jose';
import { createSession, deleteSession, getSession } from '../lib/sessionStore.js';

const router = Router();

// In-memory stores for the ATProto OAuth client
// stateStore: temporary OAuth flow state (CSRF protection), keyed by random state string
const oauthStateStore = new Map();
// oauthSessionStore: ATProto session data keyed by DID — managed by the OAuth client itself
const oauthSessionStore = new Map();

// Build the OAuth client once at module load (lazy init on first request)
let _client = null;
async function getClient() {
  if (_client) return _client;

  const clientId = process.env.ATPROTO_CLIENT_ID;
  const redirectUri = process.env.ATPROTO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error('ATPROTO_CLIENT_ID and ATPROTO_REDIRECT_URI must be set');
  }

  // Derive base URL from the client ID URL (e.g. https://avails.zhgnv.com)
  const clientUri = new URL(clientId).origin;

  // Generate an ephemeral key for private_key_jwt auth.
  // In production you'd persist this key across restarts.
  // For a single-instance app the session store is already in-memory anyway.
  const key = await JoseKey.generate(['ES256']);

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
      dpop_bound_access_tokens: true,
      scope: 'atproto transition:generic',
      jwks_uri: `${clientUri}/api/auth/jwks.json`,
    },

    keyset: [key],

    stateStore: {
      async set(key, value) { oauthStateStore.set(key, value); },
      async get(key) { return oauthStateStore.get(key); },
      async del(key) { oauthStateStore.delete(key); },
    },

    sessionStore: {
      async set(sub, value) { oauthSessionStore.set(sub, value); },
      async get(sub) { return oauthSessionStore.get(sub); },
      async del(sub) { oauthSessionStore.delete(sub); },
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
      scope: 'atproto transition:generic',
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

    const { session } = await client.callback(params);

    // Resolve the handle from the DID for display
    let handle = session.did;
    try {
      const { Agent } = await import('@atproto/api');
      const agent = new Agent(session);
      const profile = await agent.getProfile({ actor: session.did });
      handle = profile.data.handle || session.did;
    } catch {
      // Handle resolution failed — fall back to DID
    }

    const sessionId = createSession(session, session.did, handle);

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
