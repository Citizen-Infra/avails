import crypto from 'node:crypto';
import { registerStore, markDirty } from '../lib/persistence.js';

export const mcpClients = new Map();
registerStore('mcp-clients', mcpClients);

/**
 * Register a new MCP client (RFC 7591 Dynamic Client Registration)
 * @param {Object} registration - Registration body
 * @param {string[]} registration.redirect_uris - Redirect URIs
 * @param {string} registration.client_name - Human-readable client name
 * @param {string[]} [registration.grant_types] - Grant types
 * @param {string[]} [registration.response_types] - Response types
 * @param {string} [registration.token_endpoint_auth_method] - Auth method
 * @param {string} [registration.application_type] - Application type
 * @returns {{ client_id: string, redirect_uris: string[], client_name: string, grant_types: string[], response_types: string[], token_endpoint_auth_method: string }}
 */
export function registerClient(registration) {
  const client_id = crypto.randomUUID();
  const client = {
    client_id,
    redirect_uris: registration.redirect_uris,
    client_name: registration.client_name,
    grant_types: registration.grant_types || ['authorization_code'],
    response_types: registration.response_types || ['code'],
    token_endpoint_auth_method: registration.token_endpoint_auth_method || 'none',
    application_type: registration.application_type || 'native',
    did: null,
    createdAt: new Date().toISOString(),
  };
  mcpClients.set(client_id, client);
  markDirty('mcp-clients');
  return client;
}

/**
 * Get a client by client_id
 * @param {string} clientId - UUID of the registered client
 * @returns {Object|null} Client object or null if not found
 */
export function getClient(clientId) {
  return mcpClients.get(clientId) || null;
}

/**
 * Bind a DID to a client after OAuth completes
 * @param {string} clientId - UUID of the registered client
 * @param {string} did - DID to bind
 * @throws {Error} If client not found
 */
export function bindClientDid(clientId, did) {
  const client = mcpClients.get(clientId);
  if (!client) {
    throw new Error(`Client not found: ${clientId}`);
  }
  client.did = did;
  markDirty('mcp-clients');
}
