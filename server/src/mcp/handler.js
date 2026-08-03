// server/src/mcp/handler.js
import { verifyToken } from './jwt.js';
import { acceptedIssuers } from './issuers.js';
import { secretMatches } from '../lib/bearerAuth.js';
import { getClient } from './clients.js';
import { getClient as getOAuthClient } from '../routes/auth.js';
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
async function extractAuthContext(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);

  // The shared service credential is a caller, not a person. community-admin's
  // call-proposal trigger acts on behalf of a community, so it has no DID and no
  // OAuth session — and every tool that needs one must still refuse it, which is
  // why this returns an explicitly DID-less context rather than a privileged
  // one. It is checked before the JWT path because it is not a JWT and would
  // only ever fail verification there.
  const serviceSecret = process.env.AVAILS_SERVICE_SECRET;
  if (serviceSecret && secretMatches(token, serviceSecret)) {
    return { service: 'community-admin', did: null, handle: null, oauthSession: null };
  }

  try {
    // A signature only proves we minted the token; iss/aud prove we minted it
    // for THIS service. They were written and never read (#156), and avails
    // answers on two domains with one signing key (#150).
    const claims = verifyToken(getJwtSecret(), token, {
      issuer: acceptedIssuers(),
      audience: acceptedIssuers(),
    });
    // mcp_client_id IS the client_id in the new RFC 7591 flow
    const clientId = claims.mcp_client_id || claims.client_id;
    const mcpClient = getClient(clientId);
    // Both of these used to return null silently, so a valid, unexpired token
    // being rejected looked identical to no token at all — the request just
    // logged "unauthenticated" and the client reported "token expired". Say
    // which one it was; the difference is a lost registration versus a lost DID
    // binding, and they have different causes.
    if (!mcpClient) {
      console.warn(`MCP auth: no client registered for ${clientId} (token is valid) — registration lost?`);
      return null;
    }
    if (mcpClient.did !== claims.sub) {
      console.warn(
        `MCP auth: client ${clientId} is bound to ${mcpClient.did === null ? 'no DID' : mcpClient.did}` +
        `, token claims ${claims.sub} — DID binding lost or mismatched`
      );
      return null;
    }

    // Get the canonical OAuth session from the ATProto client
    // This ensures correct DPoP key bindings (not a stale session reference)
    let oauthSession = null;
    try {
      const oauthClient = await getOAuthClient();
      oauthSession = await oauthClient.restore(claims.sub);
    } catch (err) {
      console.warn('Failed to restore OAuth session for', claims.sub, ':', err.message);
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

  const authContext = await extractAuthContext(req);

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
            `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`
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
