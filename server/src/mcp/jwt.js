import crypto from 'node:crypto';

/**
 * Sign a JWT token with HS256
 * @param {string} secret - The secret key for signing
 * @param {object} payload - The claims to encode
 * @param {number} expiresInSecs - Token expiration time in seconds (default: 3600)
 * @returns {string} The JWT token
 */
export function signToken(secret, payload, expiresInSecs = 3600) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    ...payload,
    iat: now,
    exp: now + expiresInSecs,
    jti: crypto.randomUUID()
  };

  const headerEncoded = base64urlEncode(JSON.stringify(header));
  const payloadEncoded = base64urlEncode(JSON.stringify(claims));
  const message = `${headerEncoded}.${payloadEncoded}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('base64url');

  return `${message}.${signature}`;
}

/**
 * True when a JWT claim matches one of the expected values. Handles the claim
 * being an array (`aud` is allowed to be one by RFC 7519, even though signToken
 * only ever writes a string) and rejects anything non-string or empty.
 */
function claimMatches(value, expected) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  const values = Array.isArray(value) ? value : [value];
  return values.some((v) => typeof v === 'string' && v.length > 0 && allowed.includes(v));
}

/**
 * Verify a JWT token with HS256
 *
 * A valid signature proves only that WE minted this token — not that we minted
 * it for THIS service. `iss` and `aud` are written by signToken and were never
 * read back, so a token issued under one identity was accepted under any other
 * sharing the signing key. avails answers on two domains today (#150) with one
 * MCP_JWT_SECRET, so that is a live condition rather than a hypothetical.
 *
 * Both checks are opt-in: passing neither preserves the old behaviour, which
 * keeps this a safe drop-in for any caller that has no expectation to state.
 *
 * @param {string} secret - The secret key for verification
 * @param {string} token - The JWT token to verify
 * @param {object} [expect] - Optional claim expectations
 * @param {string|string[]} [expect.issuer] - Acceptable `iss` values
 * @param {string|string[]} [expect.audience] - Acceptable `aud` values
 * @returns {object} The decoded claims
 * @throws {Error} If token is invalid, signature doesn't match, token is expired,
 *                 or a stated issuer/audience expectation is not met
 */
export function verifyToken(secret, token, { issuer, audience } = {}) {
  const parts = token.split('.');

  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;

  // Verify signature by recomputing it
  const message = `${headerEncoded}.${payloadEncoded}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('base64url');

  if (signatureEncoded !== expectedSignature) {
    throw new Error('Invalid signature');
  }

  // Decode and parse payload
  let payload;
  try {
    const payloadJson = Buffer.from(payloadEncoded, 'base64url').toString('utf8');
    payload = JSON.parse(payloadJson);
  } catch (err) {
    throw new Error('Failed to decode payload');
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error('Token expired');
  }

  // Distinct messages on purpose. "Token expired" and "wrong issuer" are the
  // same symptom to a client — it re-runs OAuth — but completely different
  // causes to whoever reads the log, and today has already shown how easily
  // those get conflated.
  if (issuer !== undefined && !claimMatches(payload.iss, issuer)) {
    throw new Error(`Invalid issuer: ${JSON.stringify(payload.iss ?? null)}`);
  }
  if (audience !== undefined && !claimMatches(payload.aud, audience)) {
    throw new Error(`Invalid audience: ${JSON.stringify(payload.aud ?? null)}`);
  }

  return payload;
}

/**
 * Helper: Encode string to base64url format
 * @param {string} str - String to encode
 * @returns {string} Base64url encoded string
 */
function base64urlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64url');
}
