import crypto from 'node:crypto';

/**
 * Constant-time secret comparison, so a value cannot be recovered a byte at a
 * time from response timing. Comparing lengths first leaks only the length,
 * which is not itself a secret.
 *
 * Fails closed on anything that is not a non-empty string, which is what makes
 * an unset environment variable deny rather than match. `'' === ''` would
 * otherwise let a caller sending nothing authenticate against an unconfigured
 * secret — the exact shape of an accidental open door.
 *
 * @param {unknown} token  the credential presented by the caller
 * @param {unknown} secret the configured credential
 * @returns {boolean}
 */
export function secretMatches(token, secret) {
  if (typeof token !== 'string' || typeof secret !== 'string') return false;
  if (token.length === 0 || secret.length === 0) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The Bearer credential from an Authorization header, or null.
 *
 * Deliberately does NOT read query parameters. A credential in a URL is
 * recorded by server access logs, upstream proxies and CDNs, browser history,
 * and Referer headers on any outbound link — and stays in the shell history of
 * whoever ran the command (#156).
 *
 * @param {{headers?: Record<string, unknown>}} req
 * @returns {string|null}
 */
export function bearerFrom(req) {
  const header = req?.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}
