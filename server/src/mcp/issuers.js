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
 * `MCP_ACCEPTED_ISSUERS` is a comma-separated grace list. It was built for a
 * specific event, which has now happened: CLIENT_URL became
 * `avails.citizeninfra.org` on 2026-08-04 (#150), and `avails.zhgnv.com` is
 * listed here so tokens minted before that keep working. Without it the cutover
 * would have invalidated every outstanding MCP token at once, presenting to
 * every client as "token expired" — already the third distinct cause wearing
 * that one message. Same shape as community-admin's CA_ACCEPTED_DIDS
 * (community-admin#99).
 *
 * The old entry can be dropped once no live token still carries it. Tokens are
 * short-lived, so that is a matter of days rather than adoption — but drop it
 * on evidence, not on a date.
 */
export function acceptedIssuers() {
  const extra = (process.env.MCP_ACCEPTED_ISSUERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([getExternalBase(), ...extra])];
}
