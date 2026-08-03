import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pollUrl } from '../src/lib/pollUrl.js';

const HOST = 'https://avails.citizeninfra.org';
const DID = 'did:plc:abc123';
const RKEY = '3kxyz';

// The helper reads process.env on every call, so each test sets its own world.
beforeEach(() => {
  delete process.env.CLIENT_URL;
});

test('builds the path the client router actually serves', () => {
  process.env.CLIENT_URL = HOST;
  assert.equal(pollUrl(DID, RKEY), `${HOST}/p/${DID}/${RKEY}`);
});

test('the path matches a real route in the client router', () => {
  // The bug this file exists for (#130): the server built `/poll/:did/:rkey`
  // while the router only serves `/p/:did/:rkey`, so every scheduling email
  // and every calendar invite linked to the catch-all NotFound route. Nothing
  // in the server could notice, because the contract lives across a boundary
  // the server never reads. So read it here.
  const router = readFileSync(new URL('../../client/src/App.jsx', import.meta.url), 'utf8');
  const routes = [...router.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

  process.env.CLIENT_URL = HOST;
  const path = new URL(pollUrl(DID, RKEY)).pathname;
  // Turn each declared route into a matcher: `:param` accepts one segment.
  const matches = routes.some((route) => {
    if (route === '*') return false; // the NotFound catch-all is not a match
    const pattern = new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}$`);
    return pattern.test(path);
  });

  assert.ok(
    matches,
    `pollUrl() produced ${path}, which no client route serves. Declared routes: ${routes.join(', ')}`
  );
});

test('a trailing slash on CLIENT_URL does not produce a double slash', () => {
  // CLIENT_URL is hand-entered in Railway and regularly carries one.
  process.env.CLIENT_URL = `${HOST}/`;
  assert.equal(pollUrl(DID, RKEY), `${HOST}/p/${DID}/${RKEY}`);
});

test('surrounding whitespace in CLIENT_URL is tolerated', () => {
  process.env.CLIENT_URL = `  ${HOST}  `;
  assert.equal(pollUrl(DID, RKEY), `${HOST}/p/${DID}/${RKEY}`);
});

test('an unset CLIENT_URL falls back to the vite dev server', () => {
  assert.equal(pollUrl(DID, RKEY), `http://localhost:5173/p/${DID}/${RKEY}`);
});
