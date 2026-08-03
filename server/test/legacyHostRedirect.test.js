import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { legacyHostRedirect } from '../src/middleware/legacyHostRedirect.js';

const OLD = 'avails.zhgnv.com';
const NEW = 'https://avails.citizeninfra.org';

beforeEach(() => {
  delete process.env.LEGACY_HOSTS;
  delete process.env.CLIENT_URL;
});

// Minimal req/res doubles. Returns what the middleware did: either it called
// next(), or it issued a redirect with a status and location.
function run({ hostname, originalUrl = '/' }) {
  const result = { nexted: false, status: null, location: null };
  const req = { hostname, originalUrl };
  const res = {
    redirect(status, location) {
      result.status = status;
      result.location = location;
    },
  };
  legacyHostRedirect(req, res, () => { result.nexted = true; });
  return result;
}

test('a request on the retired host is redirected to CLIENT_URL', () => {
  process.env.LEGACY_HOSTS = OLD;
  process.env.CLIENT_URL = NEW;
  const r = run({ hostname: OLD, originalUrl: '/p/did:plc:abc/3kxyz' });
  assert.equal(r.status, 308, '308 preserves method and body; 301 would replay a POST as GET');
  assert.equal(r.location, `${NEW}/p/did:plc:abc/3kxyz`, 'the path must survive');
  assert.equal(r.nexted, false);
});

test('the query string survives', () => {
  process.env.LEGACY_HOSTS = OLD;
  process.env.CLIENT_URL = NEW;
  const r = run({ hostname: OLD, originalUrl: '/api/polls?community=cibc&status=open' });
  assert.equal(r.location, `${NEW}/api/polls?community=cibc&status=open`);
});

test('a request on the live host passes straight through', () => {
  process.env.LEGACY_HOSTS = OLD;
  process.env.CLIENT_URL = NEW;
  const r = run({ hostname: 'avails.citizeninfra.org' });
  assert.equal(r.nexted, true);
  assert.equal(r.status, null);
});

test('NEVER redirects a host to itself', () => {
  // The catastrophic case: a cutover typo puts the same host in both variables.
  // An infinite redirect loop takes the entire site down, which is far worse
  // than the stale host this middleware exists to retire.
  process.env.LEGACY_HOSTS = 'avails.citizeninfra.org';
  process.env.CLIENT_URL = NEW;
  const r = run({ hostname: 'avails.citizeninfra.org' });
  assert.equal(r.nexted, true, 'must fall through, not loop');
  assert.equal(r.status, null);
});

test('unset LEGACY_HOSTS is inert — a deploy that never sets it is unchanged', () => {
  process.env.CLIENT_URL = NEW;
  assert.equal(run({ hostname: OLD }).nexted, true);
});

test('a missing CLIENT_URL falls through rather than redirecting to nowhere', () => {
  process.env.LEGACY_HOSTS = OLD;
  const r = run({ hostname: OLD });
  assert.equal(r.nexted, true);
  assert.equal(r.location, null);
});

test('an unparseable CLIENT_URL falls through instead of throwing', () => {
  process.env.LEGACY_HOSTS = OLD;
  process.env.CLIENT_URL = 'not a url';
  assert.equal(run({ hostname: OLD }).nexted, true);
});

test('the list is comma-separated, whitespace-tolerant and case-insensitive', () => {
  process.env.LEGACY_HOSTS = ` ${OLD} , old2.example ,, `;
  process.env.CLIENT_URL = NEW;
  assert.equal(run({ hostname: 'OLD2.EXAMPLE' }).status, 308, 'Host headers are case-insensitive');
  assert.equal(run({ hostname: OLD }).status, 308);
  assert.equal(run({ hostname: 'other.example' }).nexted, true);
});

test('a trailing slash on CLIENT_URL does not produce a double slash', () => {
  process.env.LEGACY_HOSTS = OLD;
  process.env.CLIENT_URL = `${NEW}/`;
  assert.equal(run({ hostname: OLD, originalUrl: '/about' }).location, `${NEW}/about`);
});
