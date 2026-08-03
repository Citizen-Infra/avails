/**
 * Shared bearer-credential helpers (#156). These back both the MCP service
 * credential (#149) and the clear-sessions admin route, so the failure modes
 * below are the ones that would open either door.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { secretMatches, bearerFrom } from '../src/lib/bearerAuth.js';

describe('secretMatches', () => {
  it('accepts only an exact match', () => {
    assert.equal(secretMatches('s3cret', 's3cret'), true);
    assert.equal(secretMatches('s3cret', 's3crey'), false);
    assert.equal(secretMatches('s3cret', 's3cre'), false);   // shorter
    assert.equal(secretMatches('s3cret', 's3crett'), false); // longer
  });

  it('a prefix of the secret is not the secret', () => {
    // The length check runs first, so this can never reach timingSafeEqual —
    // but it is the mistake a naive startsWith would make, so pin it.
    assert.equal(secretMatches('s3c', 's3cret'), false);
    assert.equal(secretMatches('s3cretXX', 's3cret'), false);
  });

  it('fails closed when the secret is unset or empty', () => {
    // The one that matters: an unconfigured AVAILS_ADMIN_SECRET is undefined,
    // and a caller sending nothing presents ''. Naive equality would make those
    // two match each other and leave the endpoint wide open.
    assert.equal(secretMatches('', ''), false);
    assert.equal(secretMatches('', undefined), false);
    assert.equal(secretMatches(undefined, undefined), false);
    assert.equal(secretMatches(null, null), false);
    assert.equal(secretMatches('anything', undefined), false);
    assert.equal(secretMatches('anything', ''), false);
  });

  it('fails closed on non-string input rather than throwing', () => {
    // Buffer.from(42) throws, and an exception inside an auth check is a
    // 500 at best and a bypass at worst depending on where it is caught.
    for (const bad of [42, {}, [], true, Symbol('x')]) {
      assert.equal(secretMatches(bad, 'secret'), false);
      assert.equal(secretMatches('secret', bad), false);
    }
  });

  it('handles multi-byte secrets without throwing on unequal byte lengths', () => {
    // 'é' is one character but two UTF-8 bytes: comparing by string length
    // then by Buffer would hand timingSafeEqual two different-sized buffers,
    // which throws. Guard is on the Buffer lengths, so this is safe.
    assert.equal(secretMatches('é', 'ee'), false);
    assert.equal(secretMatches('é', 'é'), true);
  });
});

describe('bearerFrom', () => {
  const req = (authorization) => ({ headers: authorization === undefined ? {} : { authorization } });

  it('extracts a Bearer token', () => {
    assert.equal(bearerFrom(req('Bearer abc123')), 'abc123');
    assert.equal(bearerFrom(req('Bearer   abc123  ')), 'abc123');
  });

  it('returns null for anything that is not a Bearer header', () => {
    assert.equal(bearerFrom(req(undefined)), null);
    assert.equal(bearerFrom(req('')), null);
    assert.equal(bearerFrom(req('Basic abc123')), null);
    assert.equal(bearerFrom(req('bearer abc123')), null); // case-sensitive scheme
    assert.equal(bearerFrom(req('Bearer')), null);
    assert.equal(bearerFrom(req('Bearer    ')), null);    // whitespace only
    assert.equal(bearerFrom({}), null);
    assert.equal(bearerFrom(undefined), null);
  });

  it('never reads a credential from the query string', () => {
    // The whole point of #156: `?key=<secret>` is recorded by access logs,
    // proxies, browser history and Referer headers. Passing one must not
    // authenticate, no matter how it is spelled.
    assert.equal(bearerFrom({ headers: {}, query: { key: 'the-secret' } }), null);
    assert.equal(bearerFrom({ query: { access_token: 'the-secret' } }), null);
  });
});
