import { NodeOAuthClient, OAuthSession } from '@atproto/oauth-client-node';
import { createOAuthBudgetFetch } from './oauthInputBudget.js';

// Use the SDK's explicit session-construction hook, not URL classification:
// metadata/DID/PAR/token/refresh operations keep the bounded transport, while
// authenticated PDS record fetches retain the original transport. SessionGetter
// still uses the bounded server factory when a record request refreshes tokens.
export class BudgetedOAuthClient extends NodeOAuthClient {
  constructor({ fetch = globalThis.fetch, ...options }) {
    super({ ...options, fetch: createOAuthBudgetFetch(fetch) });
    this.resourceFetch = fetch;
  }

  createSession(server, sub) {
    return new OAuthSession(server, sub, this.sessionGetter, this.resourceFetch);
  }
}
