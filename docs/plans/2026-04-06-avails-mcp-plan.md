# Avails MCP Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an embedded MCP endpoint to the Avails Express server so AI agents can create scheduling polls, analyze response overlaps, schedule meetings, and share poll links to Telegram.

**Architecture:** JSON-RPC over HTTP (`POST /mcp`) embedded in the existing Express server, following the Smoke Signal pattern. ATProto OAuth for multi-user auth — MCP clients register dynamically, users authenticate via ATProto, server wraps tokens in HS256 JWTs. Six MCP tools: `get_poll`, `list_polls`, `create_poll`, `list_my_polls`, `schedule`, `share_poll`.

**Tech Stack:** Express 4, Node.js 22 (ES modules), `node:crypto` for JWT (no external deps), existing ATProto OAuth (`@atproto/oauth-client-node`), `fetch` for Telegram API.

**Spec:** `docs/superpowers/specs/2026-04-05-avails-mcp-design.md`

**Note on communities endpoint:** `GET /api/communities` currently proxies to `scenius-digest.vercel.app/api/groups`. This is a temporary shortcut — scenius-digest is a link-saving bot, and this community config responsibility belongs to `community-admin` (WIP). The `share_poll` tool uses this endpoint for the community→channel mapping. When community-admin is ready, only the proxy URL in `server/src/routes/communities.js` needs to change — the `share_poll` tool consumes the same `{ key: { name, output_channel } }` shape regardless of source.

---

## File Structure

New files in `server/src/mcp/`:

| File | Responsibility |
|------|----------------|
| `server/src/mcp/jwt.js` | HS256 JWT sign/verify for MCP tokens |
| `server/src/mcp/clients.js` | MCP client registration store (persist to Railway volume) |
| `server/src/mcp/oauth.js` | OAuth routes: register, authorize, callback, token exchange |
| `server/src/mcp/handler.js` | `POST /mcp` JSON-RPC dispatcher, auth extraction |
| `server/src/mcp/tools.js` | Tool implementations (create_poll, get_poll, list_polls, list_my_polls, schedule, share_poll) |
| `server/src/mcp/overlap.js` | Best-slots computation from response data |
| `server/src/mcp/telegram.js` | Telegram bot API helper for share_poll |

Modified files:

| File | Change |
|------|--------|
| `server/src/index.js` | Register MCP routes, add `TELEGRAM_BOT_TOKEN` to env check |
| `server/src/lib/persistence.js` | (No change — `registerStore` already supports new stores) |

---

### Task 1: JWT utilities

**Files:**
- Create: `server/src/mcp/jwt.js`

JWT wrapping/unwrapping for MCP tokens. Uses `node:crypto` HMAC-SHA256 — no external packages.

- [ ] **Step 1: Create `server/src/mcp/jwt.js`**

```javascript
// server/src/mcp/jwt.js
import crypto from 'node:crypto';

const ALGORITHM = 'sha256';

/**
 * Sign an MCP token wrapping an ATProto access token.
 * @param {string} secret - signing key (hex or raw string)
 * @param {object} payload - { sub, iss, aud, client_id, mcp_client_id, atproto_access_token }
 * @param {number} expiresInSecs - token lifetime
 * @returns {string} JWT string
 */
export function signToken(secret, payload, expiresInSecs = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    ...payload,
    iat: now,
    exp: now + expiresInSecs,
    jti: crypto.randomUUID(),
  };

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = crypto
    .createHmac(ALGORITHM, secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

/**
 * Verify and decode an MCP token.
 * @param {string} secret - signing key
 * @param {string} token - JWT string
 * @returns {object} decoded claims
 * @throws {Error} if invalid or expired
 */
export function verifyToken(secret, token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const [header, body, signature] = parts;
  const expected = crypto
    .createHmac(ALGORITHM, secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  if (signature !== expected) throw new Error('Invalid JWT signature');

  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now) throw new Error('Token expired');

  return claims;
}
```

- [ ] **Step 2: Verify with a quick manual test**

Run: `node -e "import('./server/src/mcp/jwt.js').then(({signToken, verifyToken}) => { const t = signToken('secret123', {sub:'did:plc:test', iss:'avails'}); console.log('token:', t.substring(0,40)+'...'); const c = verifyToken('secret123', t); console.log('claims:', c.sub, c.iss); })"`

Expected: prints token prefix and decoded claims.

- [ ] **Step 3: Commit**

```bash
git add server/src/mcp/jwt.js
git commit -m "feat(mcp): add HS256 JWT sign/verify utilities"
```

---

### Task 2: MCP client registration store

**Files:**
- Create: `server/src/mcp/clients.js`

Stores registered MCP clients in a Map persisted to Railway volume. Each client has an ID, redirect URI, and DPoP key.

- [ ] **Step 1: Create `server/src/mcp/clients.js`**

```javascript
// server/src/mcp/clients.js
import crypto from 'node:crypto';
import { registerStore, markDirty } from '../lib/persistence.js';

export const mcpClients = new Map();

registerStore('mcp-clients', mcpClients);

/**
 * Register an MCP client.
 * @param {string} clientId - client's metadata URL
 * @param {string} redirectUri - where to send auth codes
 * @param {string} dpopJwk - client's DPoP public key (JWK JSON string)
 * @returns {object} { mcpClientId, clientId, redirectUri }
 */
export function registerClient(clientId, redirectUri, dpopJwk) {
  const mcpClientId = crypto.randomUUID();
  mcpClients.set(mcpClientId, {
    mcpClientId,
    clientId,
    redirectUri,
    dpopJwk: dpopJwk || '',
    did: null,
    createdAt: new Date().toISOString(),
  });
  markDirty('mcp-clients');
  return { mcpClientId, clientId, redirectUri };
}

/**
 * Get client by internal MCP client ID.
 */
export function getClient(mcpClientId) {
  return mcpClients.get(mcpClientId) || null;
}

/**
 * Bind a DID to a client (after OAuth completes).
 */
export function bindClientDid(mcpClientId, did) {
  const client = mcpClients.get(mcpClientId);
  if (!client) throw new Error('MCP client not found');
  client.did = did;
  markDirty('mcp-clients');
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/mcp/clients.js
git commit -m "feat(mcp): add MCP client registration store with persistence"
```

---

### Task 3: MCP OAuth routes

**Files:**
- Create: `server/src/mcp/oauth.js`
- Modify: `server/src/index.js`

OAuth flow for MCP clients: register → authorize → ATProto callback → token exchange. Stores the ATProto session to Railway volume (same as web UI) so it persists.

- [ ] **Step 1: Create `server/src/mcp/oauth.js`**

```javascript
// server/src/mcp/oauth.js
import { Router } from 'express';
import crypto from 'node:crypto';
import { getClient as getOAuthClient } from '../routes/auth.js';
import { createSession } from '../lib/sessionStore.js';
import { registerClient, getClient, bindClientDid } from './clients.js';
import { signToken } from './jwt.js';

const router = Router();

// Pending auth flows: state → { mcpClientId, clientId, redirectUri, codeVerifier }
const pendingAuths = new Map();

// Issued auth codes: code → { mcpClientId, clientId, did, atprotoAccessToken, handle }
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
    });

    // Clean up old pending auths (older than 10 minutes)
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, val] of pendingAuths) {
      if (val.createdAt && val.createdAt < tenMinAgo) pendingAuths.delete(key);
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

// GET /.well-known/oauth-protected-resource/mcp — resource metadata
router.get('/resource-metadata', (req, res) => {
  const base = getExternalBase();
  res.json({
    resource: `${base}/mcp`,
    authorization_servers: [`${base}/mcp`],
    bearer_methods_supported: ['header'],
  });
});

export default router;
```

- [ ] **Step 2: Wire up MCP OAuth routes in `server/src/index.js`**

Add after the existing route registrations (after line 88 `app.use('/api/openmeet', openmeetRoutes);`):

```javascript
import mcpOauthRoutes from './mcp/oauth.js';

// MCP OAuth routes
app.use('/mcp', mcpOauthRoutes);

// MCP resource metadata (well-known)
app.get('/.well-known/oauth-protected-resource/mcp', (req, res) => {
  const base = process.env.CLIENT_URL || 'http://localhost:5173';
  res.json({
    resource: `${base}/mcp`,
    authorization_servers: [`${base}/mcp`],
    bearer_methods_supported: ['header'],
  });
});
```

- [ ] **Step 3: Test the register endpoint manually**

Run: `cd server && npm run dev`

In another terminal:
```bash
curl -s -X POST http://localhost:3000/mcp/register \
  -H "Content-Type: application/json" \
  -d '{"client_id":"https://test.example.com/mcp","redirect_uri":"https://test.example.com/callback"}' | node -e "process.stdin.pipe(process.stdout)"
```

Expected: `{"mcp_client_id":"<uuid>","client_id":"https://test.example.com/mcp"}`

- [ ] **Step 4: Commit**

```bash
git add server/src/mcp/oauth.js server/src/index.js
git commit -m "feat(mcp): add MCP OAuth flow (register, authorize, callback, token)"
```

---

### Task 4: JSON-RPC handler and auth extraction

**Files:**
- Create: `server/src/mcp/handler.js`
- Modify: `server/src/index.js`

The `POST /mcp` endpoint that dispatches JSON-RPC requests, extracts optional Bearer JWT auth.

- [ ] **Step 1: Create `server/src/mcp/handler.js`**

```javascript
// server/src/mcp/handler.js
import { verifyToken } from './jwt.js';
import { getClient } from './clients.js';
import { getSession, sessions } from '../lib/sessionStore.js';
import { callTool, listTools } from './tools.js';

const PROTOCOL_VERSION = '2025-03-26';
const SERVER_NAME = 'avails';

function getJwtSecret() {
  return process.env.MCP_JWT_SECRET || process.env.SESSION_SECRET;
}

/**
 * Extract MCP auth context from Bearer JWT token.
 * Returns null if no auth or invalid.
 */
function extractAuthContext(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  try {
    const claims = verifyToken(getJwtSecret(), token);
    const mcpClient = getClient(claims.mcp_client_id);
    if (!mcpClient) return null;
    if (mcpClient.did !== claims.sub) return null;

    // Find the user's OAuth session for PDS writes
    let oauthSession = null;
    for (const [, session] of sessions) {
      if (session.did === claims.sub && session.oauthSession) {
        oauthSession = session.oauthSession;
        break;
      }
    }

    return {
      did: claims.sub,
      handle: claims.handle,
      clientId: claims.client_id,
      mcpClientId: claims.mcp_client_id,
      oauthSession,
    };
  } catch (err) {
    console.warn('MCP auth extraction failed:', err.message);
    return null;
  }
}

function jsonRpcSuccess(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data && { data }) } };
}

/**
 * POST /mcp — handle MCP JSON-RPC requests
 */
export async function handleMcp(req, res) {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== '2.0') {
    return res.json(jsonRpcError(id, -32600, 'Invalid JSON-RPC version'));
  }

  const authContext = extractAuthContext(req);

  if (authContext) {
    console.log(`MCP request: ${method} (authenticated as ${authContext.did})`);
  } else {
    console.log(`MCP request: ${method} (unauthenticated)`);
  }

  switch (method) {
    case 'initialize':
      return res.json(jsonRpcSuccess(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: '1.0.0' },
      }));

    case 'notifications/initialized':
      return res.sendStatus(202);

    case 'prompts/list':
      return res.json(jsonRpcSuccess(id, { prompts: [] }));

    case 'resources/list':
      return res.json(jsonRpcSuccess(id, { resources: [] }));

    case 'tools/list':
      return res.json(jsonRpcSuccess(id, { tools: listTools() }));

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};

      try {
        const result = await callTool(toolName, args, authContext);
        return res.json(jsonRpcSuccess(id, {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
        }));
      } catch (err) {
        if (err.message === 'AUTH_REQUIRED') {
          const base = process.env.CLIENT_URL || 'http://localhost:5173';
          return res.status(401).set(
            'WWW-Authenticate',
            `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`
          ).json(jsonRpcError(id, -32001, 'Authentication required'));
        }
        console.error(`MCP tool error (${toolName}):`, err.message);
        return res.json(jsonRpcError(id, -32000, err.message));
      }
    }

    default:
      return res.json(jsonRpcError(id, -32601, `Method not found: ${method}`));
  }
}

/**
 * DELETE /mcp — session termination (stateless, kept for protocol compliance)
 */
export function handleMcpDelete(req, res) {
  res.sendStatus(204);
}
```

- [ ] **Step 2: Register `POST /mcp` and `DELETE /mcp` in `server/src/index.js`**

Add after the MCP OAuth routes:

```javascript
import { handleMcp, handleMcpDelete } from './mcp/handler.js';

// MCP JSON-RPC endpoint
app.post('/mcp', handleMcp);
app.delete('/mcp', handleMcpDelete);
```

- [ ] **Step 3: Commit**

```bash
git add server/src/mcp/handler.js server/src/index.js
git commit -m "feat(mcp): add JSON-RPC dispatcher with Bearer JWT auth extraction"
```

---

### Task 5: Overlap analysis

**Files:**
- Create: `server/src/mcp/overlap.js`

Computes best time slots from response data, sorted by participant count.

- [ ] **Step 1: Create `server/src/mcp/overlap.js`**

```javascript
// server/src/mcp/overlap.js

/**
 * Compute best time slots from poll responses.
 * @param {Array} responses - array of { name, slots: ['YYYY-MM-DDThh:mm', ...] }
 * @returns {Array} sorted by count descending: { slot, participants, count }
 */
export function computeBestSlots(responses) {
  const slotMap = new Map(); // slot string → Set of participant names

  for (const response of responses) {
    const name = response.name || 'Anonymous';
    if (!Array.isArray(response.slots)) continue;
    for (const slot of response.slots) {
      if (!slotMap.has(slot)) slotMap.set(slot, new Set());
      slotMap.get(slot).add(name);
    }
  }

  const bestSlots = [];
  for (const [slot, participants] of slotMap) {
    bestSlots.push({
      slot,
      participants: [...participants],
      count: participants.size,
    });
  }

  bestSlots.sort((a, b) => b.count - a.count || a.slot.localeCompare(b.slot));
  return bestSlots;
}
```

- [ ] **Step 2: Quick verification**

Run: `node -e "import('./server/src/mcp/overlap.js').then(({computeBestSlots}) => { const r = computeBestSlots([{name:'Alice',slots:['2026-04-10T09:00','2026-04-10T10:00']},{name:'Bob',slots:['2026-04-10T09:00','2026-04-10T11:00']}]); console.log(JSON.stringify(r,null,2)); })"`

Expected: `2026-04-10T09:00` has count 2 (Alice, Bob), others have count 1.

- [ ] **Step 3: Commit**

```bash
git add server/src/mcp/overlap.js
git commit -m "feat(mcp): add server-side overlap analysis for best time slots"
```

---

### Task 6: Telegram helper

**Files:**
- Create: `server/src/mcp/telegram.js`

Simple helper to post messages to Telegram channels using the Avails bot token.

- [ ] **Step 1: Create `server/src/mcp/telegram.js`**

```javascript
// server/src/mcp/telegram.js

/**
 * Post a message to a Telegram channel.
 * @param {string} chatId - Telegram chat ID (e.g., "-1002708526104")
 * @param {string} text - message text
 * @returns {object} Telegram API response
 * @throws {Error} if bot token not configured or API fails
 */
export async function sendTelegramMessage(chatId, text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN not configured');

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: false,
    }),
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.description}`);
  }

  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/mcp/telegram.js
git commit -m "feat(mcp): add Telegram message helper for share_poll"
```

---

### Task 7: MCP tool implementations

**Files:**
- Create: `server/src/mcp/tools.js`

All six tools: `get_poll`, `list_polls`, `create_poll`, `list_my_polls`, `schedule`, `share_poll`. Reuses existing patterns from `routes/polls.js` (PDS fetch, XRPC calls, poll index).

- [ ] **Step 1: Create `server/src/mcp/tools.js`**

```javascript
// server/src/mcp/tools.js
import { listByCommunity, indexPoll, updatePollStatus } from '../lib/pollIndex.js';
import { computeBestSlots } from './overlap.js';
import { sendTelegramMessage } from './telegram.js';
import { generateIcs } from '../lib/ics.js';
import { sendEmail } from '../lib/email.js';

const POLL_COLLECTION = 'chat.avails.scheduling.poll';
const RESPONSE_COLLECTION = 'chat.avails.scheduling.response';

async function resolvePds(did) {
  try {
    const res = await fetch(`https://plc.directory/${did}`);
    if (!res.ok) return 'https://bsky.social';
    const doc = await res.json();
    const endpoint = doc.service?.find(s => s.type === 'AtprotoPersonalDataServer')?.serviceEndpoint;
    return endpoint || 'https://bsky.social';
  } catch {
    return 'https://bsky.social';
  }
}

async function xrpcCall(oauthSession, method, body) {
  const url = `/xrpc/${method}`;
  const response = await oauthSession.fetchHandler(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function fetchPollFromPds(did, rkey) {
  const pds = await resolvePds(did);
  const url = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Poll not found');
  return res.json();
}

async function fetchResponsesFromPds(did) {
  const pds = await resolvePds(did);
  const url = `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(RESPONSE_COLLECTION)}&limit=100`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.records || [];
}

async function fetchCommunities() {
  try {
    const res = await fetch('https://scenius-digest.vercel.app/api/groups');
    return await res.json();
  } catch {
    return {};
  }
}

function requireAuth(authContext) {
  if (!authContext) throw new Error('AUTH_REQUIRED');
  if (!authContext.oauthSession) throw new Error('OAuth session not found. Please re-authenticate.');
  return authContext;
}

// --- Tool definitions ---

const TOOL_DEFINITIONS = [
  {
    name: 'get_poll',
    description: 'Get a scheduling poll with responses and best available time slots ranked by participant overlap',
    inputSchema: {
      type: 'object',
      properties: {
        did: { type: 'string', description: "Poll creator's DID (e.g., 'did:plc:...')" },
        rkey: { type: 'string', description: 'Poll record key' },
      },
      required: ['did', 'rkey'],
    },
  },
  {
    name: 'list_polls',
    description: 'List scheduling polls, optionally filtered by community and/or status',
    inputSchema: {
      type: 'object',
      properties: {
        community: { type: 'string', description: "Community key (e.g., 'scenius', 'cibc')" },
        status: { type: 'string', description: "'open' or 'closed'", enum: ['open', 'closed'] },
      },
    },
  },
  {
    name: 'create_poll',
    description: 'Create a new scheduling poll. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Poll title (max 200 chars)' },
        description: { type: 'string', description: 'Poll description (max 1000 chars)' },
        dates: { type: 'array', items: { type: 'string' }, description: 'Array of dates in YYYY-MM-DD format' },
        timeRange: {
          type: 'object',
          properties: {
            start: { type: 'string', description: 'Start time HH:MM' },
            end: { type: 'string', description: 'End time HH:MM' },
          },
          required: ['start', 'end'],
        },
        slotMinutes: { type: 'number', description: 'Slot duration: 15, 30, or 60', enum: [15, 30, 60] },
        timezone: { type: 'string', description: 'IANA timezone (e.g., Europe/London)' },
        community: { type: 'string', description: 'Community key for discovery' },
        notifyAfter: { type: 'number', description: 'Response count threshold for notification' },
        notifyEmail: { type: 'string', description: 'Email for notifications' },
      },
      required: ['title', 'dates', 'timeRange', 'slotMinutes', 'timezone'],
    },
  },
  {
    name: 'list_my_polls',
    description: 'List the authenticated user\'s polls. Requires authentication.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'schedule',
    description: 'Set the chosen meeting time for a poll. Closes the poll and sends calendar invites. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        did: { type: 'string', description: "Poll creator's DID" },
        rkey: { type: 'string', description: 'Poll record key' },
        finalTime: { type: 'string', description: 'Chosen time in ISO 8601 format' },
        finalDuration: { type: 'number', description: 'Duration in minutes' },
      },
      required: ['did', 'rkey', 'finalTime', 'finalDuration'],
    },
  },
  {
    name: 'share_poll',
    description: 'Post the poll link to a community Telegram channel. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        did: { type: 'string', description: "Poll creator's DID" },
        rkey: { type: 'string', description: 'Poll record key' },
        community: { type: 'string', description: 'Community key (determines Telegram channel)' },
        message: { type: 'string', description: 'Optional custom message to include' },
      },
      required: ['did', 'rkey', 'community'],
    },
  },
];

export function listTools() {
  return TOOL_DEFINITIONS;
}

// --- Tool implementations ---

async function toolGetPoll({ did, rkey }) {
  const record = await fetchPollFromPds(did, rkey);
  const poll = record.value;

  // Fetch responses for this poll
  const allResponses = await fetchResponsesFromPds(did);
  const pollUri = `at://${did}/${POLL_COLLECTION}/${rkey}`;
  const responses = allResponses
    .filter(r => r.value.pollUri === pollUri)
    .map(r => ({ name: r.value.name, slots: r.value.slots, email: r.value.email, createdAt: r.value.createdAt }));

  const bestSlots = computeBestSlots(responses);
  const url = `${process.env.CLIENT_URL || 'https://avails.zhgnv.com'}/p/${did}/${rkey}`;

  return JSON.stringify({
    poll: {
      title: poll.title,
      description: poll.description,
      dates: poll.dates,
      timeRange: poll.timeRange,
      slotMinutes: poll.slotMinutes,
      timezone: poll.timezone,
      community: poll.community,
      status: poll.status || 'open',
      finalTime: poll.finalTime,
      finalDuration: poll.finalDuration,
    },
    url,
    responses,
    bestSlots,
    responseCount: responses.length,
  }, null, 2);
}

async function toolListPolls({ community, status }) {
  const polls = listByCommunity(community, status || 'open');
  return JSON.stringify(polls, null, 2);
}

async function toolCreatePoll(args, authContext) {
  const auth = requireAuth(authContext);

  const record = {
    $type: POLL_COLLECTION,
    title: args.title,
    dates: args.dates,
    timeRange: args.timeRange,
    slotMinutes: args.slotMinutes,
    timezone: args.timezone,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  if (args.description) record.description = args.description;
  if (args.community) record.community = args.community;
  if (args.notifyAfter) record.notifyAfter = args.notifyAfter;
  if (args.notifyEmail) record.notifyEmail = args.notifyEmail;

  const result = await xrpcCall(auth.oauthSession, 'com.atproto.repo.createRecord', {
    repo: auth.did,
    collection: POLL_COLLECTION,
    record,
  });

  const rkey = result.uri.split('/').pop();
  indexPoll(auth.did, rkey, {
    title: args.title,
    community: args.community || null,
    status: 'open',
  });

  const url = `${process.env.CLIENT_URL || 'https://avails.zhgnv.com'}/p/${auth.did}/${rkey}`;

  return JSON.stringify({
    uri: result.uri,
    cid: result.cid,
    rkey,
    did: auth.did,
    url,
  }, null, 2);
}

async function toolListMyPolls(args, authContext) {
  const auth = requireAuth(authContext);
  const pds = await resolvePds(auth.did);
  const url = `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(auth.did)}&collection=${encodeURIComponent(POLL_COLLECTION)}&limit=50`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch polls from PDS');
  const data = await res.json();

  const polls = (data.records || []).map(r => ({
    rkey: r.uri.split('/').pop(),
    title: r.value.title,
    dates: r.value.dates,
    status: r.value.status || 'open',
    community: r.value.community,
    createdAt: r.value.createdAt,
  })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return JSON.stringify(polls, null, 2);
}

async function toolSchedule(args, authContext) {
  const auth = requireAuth(authContext);
  const { did, rkey, finalTime, finalDuration } = args;

  if (auth.did !== did) throw new Error('Only the poll creator can schedule');

  const existing = await fetchPollFromPds(did, rkey);
  const updatedRecord = {
    ...existing.value,
    finalTime,
    finalDuration,
    status: 'finalized',
  };

  await xrpcCall(auth.oauthSession, 'com.atproto.repo.putRecord', {
    repo: did,
    collection: POLL_COLLECTION,
    rkey,
    record: updatedRecord,
    swapRecord: existing.cid,
  });

  updatePollStatus(did, rkey, 'finalized');

  // Send email notifications to participants who provided emails
  const allResponses = await fetchResponsesFromPds(did);
  const pollUri = `at://${did}/${POLL_COLLECTION}/${rkey}`;
  const emailList = allResponses
    .filter(r => r.value.pollUri === pollUri && r.value.email)
    .map(r => r.value.email);

  const pollUrl = `${process.env.CLIENT_URL || 'https://avails.zhgnv.com'}/p/${did}/${rkey}`;
  let emailsSent = 0;

  if (emailList.length > 0) {
    const icsContent = generateIcs(updatedRecord, pollUrl);
    const icsBase64 = Buffer.from(icsContent).toString('base64');

    const results = await Promise.allSettled(
      emailList.map(email =>
        sendEmail({
          to: email,
          subject: `${updatedRecord.title} — time confirmed`,
          html: `<p>The poll <strong>${updatedRecord.title}</strong> has been scheduled.</p><p><a href="${pollUrl}">View poll</a></p><p>A calendar invite is attached.</p>`,
          attachments: [{ filename: 'invite.ics', content: icsBase64 }],
        })
      )
    );
    emailsSent = results.filter(r => r.status === 'fulfilled').length;
  }

  return JSON.stringify({
    scheduled: true,
    finalTime,
    finalDuration,
    emailsSent,
    url: pollUrl,
  }, null, 2);
}

async function toolSharePoll(args, authContext) {
  requireAuth(authContext);
  const { did, rkey, community, message } = args;

  // Fetch poll details
  const record = await fetchPollFromPds(did, rkey);
  const poll = record.value;

  // Fetch community config for output channel
  const communities = await fetchCommunities();
  const communityConfig = communities[community];
  if (!communityConfig) throw new Error(`Community '${community}' not found`);
  if (!communityConfig.output_channel) throw new Error(`Community '${community}' has no output channel configured`);

  const url = `${process.env.CLIENT_URL || 'https://avails.zhgnv.com'}/p/${did}/${rkey}`;
  const dates = (poll.dates || []).join(', ');

  let text = `📅 ${poll.title}\n`;
  if (poll.description) text += `${poll.description}\n`;
  text += `\n📆 ${dates}`;
  text += `\n⏰ ${poll.timeRange?.start} – ${poll.timeRange?.end} (${poll.timezone})`;
  if (message) text += `\n\n${message}`;
  text += `\n\n🔗 ${url}`;

  const result = await sendTelegramMessage(communityConfig.output_channel, text);

  return JSON.stringify({
    shared: true,
    channel: communityConfig.name,
    messageId: result.result?.message_id,
    url,
  }, null, 2);
}

/**
 * Dispatch a tool call.
 * @throws {Error} with message 'AUTH_REQUIRED' if auth needed but missing
 */
export async function callTool(name, args, authContext) {
  switch (name) {
    case 'get_poll': return toolGetPoll(args);
    case 'list_polls': return toolListPolls(args);
    case 'create_poll': return toolCreatePoll(args, authContext);
    case 'list_my_polls': return toolListMyPolls(args, authContext);
    case 'schedule': return toolSchedule(args, authContext);
    case 'share_poll': return toolSharePoll(args, authContext);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
```

- [ ] **Step 2: Verify imports resolve**

Run: `node --check server/src/mcp/tools.js`

Check that `../lib/ics.js` and `../lib/email.js` exist:

```bash
ls server/src/lib/ics.js server/src/lib/email.js
```

If they don't exist or have different names, update the imports. Check the actual filenames:

```bash
ls server/src/lib/
```

- [ ] **Step 3: Commit**

```bash
git add server/src/mcp/tools.js
git commit -m "feat(mcp): implement all 6 MCP tools (get_poll, list_polls, create_poll, list_my_polls, schedule, share_poll)"
```

---

### Task 8: Wire everything together in index.js

**Files:**
- Modify: `server/src/index.js`

Final wiring — all MCP routes, request logging for `/mcp`, and `TELEGRAM_BOT_TOKEN` env var mention.

- [ ] **Step 1: Update `server/src/index.js` with all MCP imports and routes**

The full set of additions to `index.js` (some were added in earlier tasks — verify they're all present):

After existing imports at the top:
```javascript
import mcpOauthRoutes from './mcp/oauth.js';
import { handleMcp, handleMcpDelete } from './mcp/handler.js';
```

After the request logging middleware, update the path check to include `/mcp`:
```javascript
if (req.path.startsWith('/api') || req.path.startsWith('/mcp')) {
```

After `app.use('/api/openmeet', openmeetRoutes);`:
```javascript
// MCP OAuth routes (register, authorize, callback, token)
app.use('/mcp', mcpOauthRoutes);

// MCP JSON-RPC endpoint
app.post('/mcp', handleMcp);
app.delete('/mcp', handleMcpDelete);

// MCP resource metadata (well-known)
app.get('/.well-known/oauth-protected-resource/mcp', (req, res) => {
  const base = process.env.CLIENT_URL || 'http://localhost:5173';
  res.json({
    resource: `${base}/mcp`,
    authorization_servers: [`${base}/mcp`],
    bearer_methods_supported: ['header'],
  });
});
```

- [ ] **Step 2: Verify server starts without errors**

Run: `cd server && node --check src/index.js`

Then: `cd server && npm run dev`

Check console for startup errors. The server should start and log `Avails server listening on port 3000`.

- [ ] **Step 3: Test the full MCP flow manually**

Test `tools/list`:
```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).result.tools.map(t=>t.name)"
```

Expected: `['get_poll', 'list_polls', 'create_poll', 'list_my_polls', 'schedule', 'share_poll']`

Test `initialize`:
```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).result.serverInfo"
```

Expected: `{ name: 'avails', version: '1.0.0' }`

Test `list_polls` (unauthenticated):
```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_polls","arguments":{"status":"open"}}}' | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).result"
```

Expected: success response with content array.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.js
git commit -m "feat(mcp): wire MCP routes into Express server"
```

---

### Task 9: Deploy and verify

**Files:** (none — deployment only)

- [ ] **Step 1: Set environment variables on Railway**

Add to Railway environment:
- `TELEGRAM_BOT_TOKEN` — create a new bot via BotFather first, add it as admin to community output channels
- `MCP_JWT_SECRET` — optional (falls back to `SESSION_SECRET`)

- [ ] **Step 2: Push to GitHub (triggers Railway auto-deploy)**

```bash
git push origin main
```

- [ ] **Step 3: Verify deployment**

```bash
curl -s -X POST https://avails.zhgnv.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).result.serverInfo"
```

Expected: `{ name: 'avails', version: '1.0.0' }`

- [ ] **Step 4: Test unauthenticated tools against production**

```bash
curl -s -X POST https://avails.zhgnv.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).result.tools.length"
```

Expected: `6`

---

### Task 10: Add MCP server to Claude Code config

**Files:**
- Modify: Claude Code MCP settings

- [ ] **Step 1: Add Avails MCP server to Claude Code**

Add to `.claude/settings.local.json` or via Claude Code settings:

```json
{
  "mcpServers": {
    "avails": {
      "type": "http",
      "url": "https://avails.zhgnv.com/mcp"
    }
  }
}
```

Note: Authenticated tools will require the OAuth flow to be completed first. For initial testing, `get_poll` and `list_polls` work without auth.

- [ ] **Step 2: Test from Claude Code**

Ask Claude Code to list polls or get a specific poll to verify the MCP connection works.

- [ ] **Step 3: Commit config if applicable**

If MCP config is in a committed file, commit it.
