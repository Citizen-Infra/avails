/**
 * GET /mcp must return 405, not the SPA shell.
 *
 * MCP's Streamable HTTP transport lets a client open a server-to-client SSE
 * stream with a GET to the MCP endpoint. The spec (2025-06-18, "Listening for
 * Messages from the Server") is a MUST:
 *
 *   The server MUST either return `Content-Type: text/event-stream` in response
 *   to this HTTP GET, or else return HTTP 405 Method Not Allowed, indicating
 *   that the server does not offer an SSE stream at this endpoint.
 *
 * No GET route was registered for /mcp, so the request fell through to the SPA
 * fallback and got `200 text/html`. That is neither branch of the MUST: the
 * client sees a success, tries to read a stream, hits end-of-body immediately,
 * and reconnects — with no 405 to tell it the endpoint has no stream. On
 * 2026-08-04 production logged a continuous GET /mcp loop at 2-3/s that ran for
 * hours and only stopped when the container was replaced.
 *
 * Avails' MCP is request/response only — it never initiates messages — so 405
 * is the correct branch. RFC 9110 also requires an Allow header on a 405.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';

import { handleMcpGet } from '../src/mcp/handler.js';

describe('GET /mcp (MCP Streamable HTTP)', () => {
  let server;
  let port;

  before(async () => {
    const app = express();

    // Mirrors index.js's mount order. A stand-in for mcpOauthRoutes rather than
    // the real router: what is under test is Express's routing between a
    // `use('/mcp', router)` mount and an exact `get('/mcp')`, and the stand-in
    // exercises that faithfully without dragging in the OAuth module's env.
    const oauthish = express.Router();
    oauthish.get('/authorize', (req, res) => res.json({ route: 'authorize' }));
    app.use('/mcp', oauthish);

    app.get('/mcp', handleMcpGet);
    app.post('/mcp', (req, res) => res.json({ route: 'rpc' }));

    // The catch-all that used to answer GET /mcp.
    app.get('*', (req, res) => res.type('html').send('<!doctype html>app shell'));

    server = app.listen(0);
    await once(server, 'listening');
    port = server.address().port;
  });

  after(() => server?.close());

  it('405s instead of serving the SPA shell', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      headers: { Accept: 'text/event-stream' },
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(res.status, 405);
    assert.doesNotMatch(res.headers.get('content-type') || '', /text\/html/);
    assert.doesNotMatch(await res.text(), /app shell/);
  });

  it('carries an Allow header naming the methods that do work', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      signal: AbortSignal.timeout(3000),
    });
    const allow = res.headers.get('allow') || '';
    assert.match(allow, /POST/);
    assert.match(allow, /DELETE/);
  });

  it('leaves the OAuth sub-routes alone', async () => {
    // The 405 must match /mcp exactly. Swallowing /mcp/authorize would break
    // the whole MCP sign-in flow.
    const res = await fetch(`http://localhost:${port}/mcp/authorize`, {
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { route: 'authorize' });
  });

  it('leaves POST /mcp alone', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { route: 'rpc' });
  });
});
