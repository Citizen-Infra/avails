import crypto from 'node:crypto';
import { registerStore, markDirty } from '../lib/persistence.js';

export const mcpClients = new Map();
registerStore('mcp-clients', mcpClients);

/**
 * Register a new MCP client
 * @param {string} clientId - MCP client's metadata URL
 * @param {string} redirectUri - Where to send auth codes
 * @param {string} dpopJwk - DPoP key (string)
 * @returns {{ mcpClientId: string, clientId: string, redirectUri: string }}
 */
export function registerClient(clientId, redirectUri, dpopJwk) {
  const mcpClientId = crypto.randomUUID();
  const client = {
    mcpClientId,
    clientId,
    redirectUri,
    dpopJwk,
    did: null,
    createdAt: new Date().toISOString(),
  };
  mcpClients.set(mcpClientId, client);
  markDirty('mcp-clients');
  return { mcpClientId, clientId, redirectUri };
}

/**
 * Get a client by mcpClientId
 * @param {string} mcpClientId - UUID of the registered client
 * @returns {Object|null} Client object or null if not found
 */
export function getClient(mcpClientId) {
  return mcpClients.get(mcpClientId) || null;
}

/**
 * Bind a DID to a client after OAuth completes
 * @param {string} mcpClientId - UUID of the registered client
 * @param {string} did - DID to bind
 * @throws {Error} If client not found
 */
export function bindClientDid(mcpClientId, did) {
  const client = mcpClients.get(mcpClientId);
  if (!client) {
    throw new Error(`Client not found: ${mcpClientId}`);
  }
  client.did = did;
  markDirty('mcp-clients');
}
