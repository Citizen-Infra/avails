/**
 * Regression tests for the SPA fallback (#109).
 *
 * The catch-all matched every GET, then for an /api path returned without
 * calling res.* and without calling next() — Express treats the request as
 * in-flight and nothing else runs, so it hung until the client gave up while
 * the socket stayed open (Node's requestTimeout defaults to 300s). Unmatched
 * /api paths are what scanners probe, so each probe held a connection.
 *
 * AbortSignal.timeout is what makes a regression fail fast here: without it a
 * reintroduced hang would stall the suite rather than fail it.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { spaFallback } from '../src/middleware/spaFallback.js';

describe('SPA fallback (#109)', () => {
  let server;
  let port;
  let clientDist;

  before(async () => {
    clientDist = fs.mkdtempSync(path.join(os.tmpdir(), 'avails-spa-'));
    fs.writeFileSync(path.join(clientDist, 'index.html'), '<!doctype html><title>app shell</title>');

    const app = express();
    // A real API route, so the tests distinguish "matched" from "fell through".
    app.get('/api/real', (req, res) => res.json({ ok: true }));
    app.get('*', spaFallback(clientDist));

    server = app.listen(0);
    await once(server, 'listening');
    port = server.address().port;
  });

  after(() => {
    server?.close();
    fs.rmSync(clientDist, { recursive: true, force: true });
  });

  it('an unmatched /api GET returns a JSON 404 rather than hanging', async () => {
    const res = await fetch(`http://localhost:${port}/api/definitely-not-a-route`, {
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Not found' });
  });

  it('does not swallow a real API route', async () => {
    const res = await fetch(`http://localhost:${port}/api/real`, {
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it('still serves the SPA shell for a client route', async () => {
    const res = await fetch(`http://localhost:${port}/p/did:plc:abc/rkey1`, {
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /app shell/);
  });
});
