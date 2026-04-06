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
 * Verify a JWT token with HS256
 * @param {string} secret - The secret key for verification
 * @param {string} token - The JWT token to verify
 * @returns {object} The decoded claims
 * @throws {Error} If token is invalid, signature doesn't match, or token is expired
 */
export function verifyToken(secret, token) {
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
