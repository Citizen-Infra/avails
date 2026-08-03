/**
 * MCP token issuer/audience validation (#156, fix 3).
 *
 * signToken has always written `iss` and `aud`; verifyToken never read them
 * back, so a token minted under one identity was accepted under any other
 * sharing the signing key. avails answers on two domains today (#150) with one
 * MCP_JWT_SECRET, which is what makes that a live condition and not a
 * hypothetical.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../src/mcp/jwt.js';
import { acceptedIssuers, getExternalBase } from '../src/mcp/issuers.js';

const SECRET = 'test-signing-secret';
const HOME = 'https://avails.example';
const OTHER = 'https://someone-else.example';

const mint = (claims, secret = SECRET) => signToken(secret, claims, 3600);

describe('verifyToken issuer/audience', () => {
  it('accepts a token whose iss and aud match', () => {
    const t = mint({ sub: 'did:plc:a', iss: HOME, aud: HOME });
    const claims = verifyToken(SECRET, t, { issuer: HOME, audience: HOME });
    assert.equal(claims.sub, 'did:plc:a');
  });

  it('rejects a token minted for a different issuer', () => {
    // The bug: same signing key, different identity. Before this check the
    // token below verified cleanly.
    const t = mint({ sub: 'did:plc:a', iss: OTHER, aud: OTHER });
    assert.throws(() => verifyToken(SECRET, t, { issuer: HOME }), /Invalid issuer/);
    assert.throws(() => verifyToken(SECRET, t, { audience: HOME }), /Invalid audience/);
  });

  it('rejects a token with the claim missing entirely', () => {
    const t = mint({ sub: 'did:plc:a' });
    assert.throws(() => verifyToken(SECRET, t, { issuer: HOME }), /Invalid issuer/);
    assert.throws(() => verifyToken(SECRET, t, { audience: HOME }), /Invalid audience/);
  });

  it('accepts any value in a list — the grace list a domain migration needs', () => {
    const old = mint({ sub: 'did:plc:a', iss: OTHER, aud: OTHER });
    const now = mint({ sub: 'did:plc:a', iss: HOME, aud: HOME });
    const both = { issuer: [HOME, OTHER], audience: [HOME, OTHER] };
    assert.equal(verifyToken(SECRET, old, both).sub, 'did:plc:a');
    assert.equal(verifyToken(SECRET, now, both).sub, 'did:plc:a');
  });

  it('handles an array aud, which RFC 7519 permits even though we never mint one', () => {
    const t = mint({ sub: 'did:plc:a', aud: [OTHER, HOME] });
    assert.equal(verifyToken(SECRET, t, { audience: HOME }).sub, 'did:plc:a');
    assert.throws(() => verifyToken(SECRET, t, { audience: 'https://third.example' }), /Invalid audience/);
  });

  it('rejects non-string and empty claims rather than coercing them', () => {
    for (const bad of [42, null, '', {}]) {
      const t = mint({ sub: 'did:plc:a', iss: bad });
      assert.throws(() => verifyToken(SECRET, t, { issuer: HOME }), /Invalid issuer/);
    }
  });

  it('stating no expectation preserves the old behaviour', () => {
    // Backward compatibility is what makes this a safe drop-in: a caller with
    // nothing to assert gets exactly what it got before.
    const t = mint({ sub: 'did:plc:a', iss: OTHER, aud: OTHER });
    assert.equal(verifyToken(SECRET, t).sub, 'did:plc:a');
  });

  it('signature and expiry are still checked first', () => {
    const t = mint({ sub: 'did:plc:a', iss: HOME, aud: HOME });
    assert.throws(() => verifyToken('wrong-secret', t, { issuer: HOME }), /Invalid signature/);

    const expired = signToken(SECRET, { sub: 'did:plc:a', iss: OTHER, aud: OTHER }, -10);
    // Wrong issuer AND expired: the expiry message wins, so a routine expiry is
    // never misreported as an identity problem.
    assert.throws(() => verifyToken(SECRET, expired, { issuer: HOME }), /Token expired/);
  });
});

describe('acceptedIssuers', () => {
  const saved = { CLIENT_URL: process.env.CLIENT_URL, MCP_ACCEPTED_ISSUERS: process.env.MCP_ACCEPTED_ISSUERS };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('is the live identity when no grace list is set', () => {
    process.env.CLIENT_URL = HOME;
    delete process.env.MCP_ACCEPTED_ISSUERS;
    assert.deepEqual(acceptedIssuers(), [HOME]);
  });

  it('adds the grace list, trimming and dropping empties', () => {
    process.env.CLIENT_URL = HOME;
    process.env.MCP_ACCEPTED_ISSUERS = ` ${OTHER} , , https://third.example ,`;
    assert.deepEqual(acceptedIssuers(), [HOME, OTHER, 'https://third.example']);
  });

  it('deduplicates when the grace list repeats the live identity', () => {
    process.env.CLIENT_URL = HOME;
    process.env.MCP_ACCEPTED_ISSUERS = HOME;
    assert.deepEqual(acceptedIssuers(), [HOME]);
  });

  it('always contains exactly what signToken would write, byte for byte', () => {
    // A trailing slash is the trap: normalising here but not in signToken would
    // reject our own freshly-minted tokens.
    process.env.CLIENT_URL = 'https://avails.example/';
    delete process.env.MCP_ACCEPTED_ISSUERS;
    const t = mint({ sub: 'did:plc:a', iss: getExternalBase(), aud: getExternalBase() });
    assert.equal(verifyToken(SECRET, t, { issuer: acceptedIssuers(), audience: acceptedIssuers() }).sub, 'did:plc:a');
  });
});
