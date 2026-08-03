/**
 * This service's external identity, and the identities it will accept on a
 * token. Kept in its own module so both the OAuth router and the request
 * handler can read it without importing each other.
 */

export function getExternalBase() {
  return process.env.CLIENT_URL || 'http://localhost:5173';
}

/**
 * Issuer/audience values accepted on an MCP token.
 *
 * `getExternalBase()` is included verbatim rather than normalised, so it is
 * byte-identical to what `signToken` writes. A normalising step here that
 * signToken does not perform would reject our own freshly-minted tokens.
 *
 * `MCP_ACCEPTED_ISSUERS` is a comma-separated grace list, and it exists for a
 * specific upcoming event: CLIENT_URL is `avails.zhgnv.com` today and is due to
 * become `avails.citizeninfra.org` (#150). Without a grace list that cutover
 * invalidates every outstanding MCP token at once, presenting to every client
 * as "token expired" — which is already the third distinct cause wearing that
 * one message. Listing the old value here during the migration turns a flag day
 * into a rollover. Same shape as community-admin's CA_ACCEPTED_DIDS
 * (community-admin#99), which #150 already names as the pattern to copy.
 */
export function acceptedIssuers() {
  const extra = (process.env.MCP_ACCEPTED_ISSUERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([getExternalBase(), ...extra])];
}
