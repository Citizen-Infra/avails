import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { corsOrigins, corsOriginCheck } from '../src/lib/corsOrigins.js';

const OLD = 'https://avails.zhgnv.com';
const NEW = 'https://avails.citizeninfra.org';

// The functions read process.env on every call, so each test sets its own world.
beforeEach(() => {
  delete process.env.CLIENT_URL;
  delete process.env.CORS_ORIGINS;
});

// Calls the middleware callback synchronously and returns what cors would receive.
function check(origin) {
  let result;
  corsOriginCheck(origin, (err, allowed) => {
    assert.equal(err, null, 'the callback must never receive an Error');
    result = allowed;
  });
  return result;
}

test('CLIENT_URL alone behaves exactly as before this change', () => {
  process.env.CLIENT_URL = OLD;
  assert.deepEqual(corsOrigins(), [OLD]);
  assert.equal(check(OLD), true);
});

test('both migration hosts are accepted at once — the point of the issue', () => {
  process.env.CLIENT_URL = NEW; // redirects and email links move immediately
  process.env.CORS_ORIGINS = OLD; // the old host keeps working meanwhile
  assert.equal(check(NEW), true);
  assert.equal(check(OLD), true);
});

test('an unlisted origin is refused with false, not an Error', () => {
  process.env.CLIENT_URL = NEW;
  // Calling back with an Error turns a routine cross-origin request into a 500.
  // `false` omits the header and lets the browser do the refusing.
  assert.equal(check('https://example.test'), false);
});

test('a request with no Origin header is allowed through', () => {
  process.env.CLIENT_URL = NEW;
  // curl, server-to-server, and the avails web app itself, which is served from
  // the same Railway service as the API and so is always same-origin.
  assert.equal(check(undefined), true);
});

test('a trailing slash in config still matches a real Origin header', () => {
  // Origin headers never carry one; hand-written env values regularly do.
  process.env.CLIENT_URL = `${NEW}/`;
  process.env.CORS_ORIGINS = `${OLD}/`;
  assert.equal(check(NEW), true);
  assert.equal(check(OLD), true);
});

test('the list is whitespace-tolerant and de-duplicated', () => {
  process.env.CLIENT_URL = NEW;
  process.env.CORS_ORIGINS = ` ${OLD} , ${NEW} ,, `;
  assert.deepEqual(corsOrigins(), [NEW, OLD]);
});

test('an unset CLIENT_URL falls back to the vite dev server', () => {
  assert.deepEqual(corsOrigins(), ['http://localhost:5173']);
  assert.equal(check('http://localhost:5173'), true);
});
