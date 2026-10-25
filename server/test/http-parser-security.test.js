/**
 * Regression coverage for the compatible backend security refresh.
 * Tiny synthetic payloads, loopback listeners only, no app/PDS/OAuth startup.
 * Late decompressor errors run in bounded child processes so an affected parser
 * fails the test without taking down the test runner or leaving a server alive.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { gzipSync, deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import express from 'express';
import rateLimit, { MemoryStore } from 'express-rate-limit';

const require = createRequire(import.meta.url);
const payload = { example: 'synthetic parser fixture' };
const json = Buffer.from(JSON.stringify(payload));

function request(port, method, body, encoding, forwarded) {
  return new Promise((resolve, reject) => {
    const headers = body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {};
    if (encoding) headers['Content-Encoding'] = encoding;
    if (forwarded) headers['X-Forwarded-For'] = forwarded;
    const req = httpRequest({ hostname: '127.0.0.1', port, path: '/fixture', method, headers, agent: false }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        let body;
        try { body = JSON.parse(text); } catch { body = text; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.setTimeout(1500, () => req.destroy(new Error('Synthetic request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function withParser(run) {
  const app = express();
  app.use(express.json()); // Match production's defaults, including compression.
  app.post('/fixture', (req, res) => res.json(req.body));
  app.get('/fixture', (req, res) => res.json({ status: 'ok' }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.type || 'parse_error' }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    return await run(server.address().port);
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}

function installed(name, from = require) {
  const entry = from.resolve(name);
  for (let dir = dirname(entry); ; dir = dirname(dir)) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      if (pkg.name === name) return { version: pkg.version, require: createRequire(entry) };
    }
    if (dirname(dir) === dir) throw new Error(`Cannot locate installed ${name}`);
  }
}

function atLeastInMajor(actual, minimum) {
  assert.match(actual, /^\d+\.\d+\.\d+$/);
  const a = actual.split('.').map(Number), b = minimum.split('.').map(Number);
  assert.equal(a[0], b[0], 'Keep the reviewed dependency major');
  assert.ok(a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2]), `${actual} must be at least ${minimum}`);
}

if (process.argv[2] === '--parser-fixture') {
  const deadline = setTimeout(() => process.exit(72), 5000);
  process.once('uncaughtException', () => { process.stderr.write('UNCAUGHT_PARSER_ERROR\n'); process.exit(71); });
  try {
    const encoding = process.argv[3];
    assert.ok(['gzip', 'deflate'].includes(encoding));
    await withParser(async port => {
      const compressed = encoding === 'gzip' ? gzipSync(json) : deflateSync(json);
      // Match the upstream regression shape: zero terminator plus a bounded
      // trailing chunk large enough to arrive after the frame has completed.
      const response = await request(port, 'POST', Buffer.concat([compressed, Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]), encoding);
      // The vulnerability is the *late process crash*, not a specific response
      // status: depending on stream timing, a response may already be committed.
      assert.ok([200, 400].includes(response.status));
      if (response.status === 200) assert.deepEqual(response.body, payload);
      await new Promise(resolve => setTimeout(resolve, 150));
      const health = await request(port, 'GET');
      assert.equal(health.status, 200);
      assert.deepEqual(health.body, { status: 'ok' });
    });
    process.stdout.write(JSON.stringify({ survived: true, listenerClosed: true }) + '\n');
  } finally {
    clearTimeout(deadline);
  }
} else {
  describe('default HTTP JSON parser security', () => {
    for (const encoding of [undefined, 'gzip', 'deflate']) {
      it(`still accepts valid ${encoding || 'uncompressed'} JSON`, { timeout: 5000 }, async () => {
        await withParser(async port => {
          const body = encoding === 'gzip' ? gzipSync(json) : encoding === 'deflate' ? deflateSync(json) : json;
          const response = await request(port, 'POST', body, encoding);
          assert.equal(response.status, 200);
          assert.deepEqual(response.body, payload);
        });
      });
    }

    it('retains the default JSON size limit and stays available after rejection', { timeout: 5000 }, async () => {
      await withParser(async port => {
        const body = Buffer.from(JSON.stringify({ text: 'x'.repeat(110 * 1024) }));
        assert.equal((await request(port, 'POST', body)).status, 413);
        assert.equal((await request(port, 'GET')).status, 200);
      });
    });

    it('rejects invalid JSON and stays available', { timeout: 5000 }, async () => {
      await withParser(async port => {
        assert.equal((await request(port, 'POST', Buffer.from('{invalid'))).status, 400);
        assert.equal((await request(port, 'GET')).status, 200);
      });
    });

    for (const encoding of ['gzip', 'deflate']) {
      it(`survives late ${encoding} decompressor errors in a bounded child`, { timeout: 10000 }, () => {
        const child = spawnSync(process.execPath, ['--max-old-space-size=64', fileURLToPath(import.meta.url), '--parser-fixture', encoding], { encoding: 'utf8', timeout: 8000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
        assert.equal(child.error, undefined);
        assert.equal(child.status, 0, child.stderr);
        assert.deepEqual(JSON.parse(child.stdout), { survived: true, listenerClosed: true });
      });
    }
  });

  describe('installed backend security floors', () => {
    const http = installed('express'), limiter = installed('express-rate-limit');
    const parser = installed('body-parser', http.require);
    const fetchNode = installed('@atproto-labs/fetch-node');
    for (const [name, minimum, from] of [
      ['express', '4.22.3', require],
      ['body-parser', '1.20.9', http.require],
      ['proxy-addr', '2.0.8', http.require],
      ['qs', '6.16.0', http.require],
      ['qs', '6.16.0', parser.require],
      ['express-rate-limit', '8.7.1', require],
      ['ip-address', '10.7.4', limiter.require],
      ['undici', '6.29.1', fetchNode.require],
    ]) {
      it(`${name} resolves to the reviewed fixed line (>= ${minimum})`, () => {
        atLeastInMajor(installed(name, from).version, minimum);
      });
    }
  });

  describe('rate limiting behind the configured single proxy hop', () => {
    for (const [label, first, sameBucket, differentBucket] of [
      ['IPv4', '203.0.113.10', '203.0.113.10', '203.0.113.11'],
      ['IPv6 /56', '2001:db8:abcd:1200::1', '2001:db8:abcd:12ff::2', '2001:db8:abcd:1300::1'],
    ]) {
      it(`retains ${label} limiting and separates other clients`, { timeout: 5000 }, async () => {
        const app = express(), store = new MemoryStore();
        app.set('trust proxy', 1);
        app.use(rateLimit({ windowMs: 60_000, max: 2, store }));
        app.get('/fixture', (req, res) => res.json({ status: 'ok' }));
        const server = app.listen(0, '127.0.0.1');
        try {
          await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
          const port = server.address().port;
          assert.equal((await request(port, 'GET', undefined, undefined, first)).status, 200);
          assert.equal((await request(port, 'GET', undefined, undefined, sameBucket)).status, 200);
          assert.equal((await request(port, 'GET', undefined, undefined, first)).status, 429);
          assert.equal((await request(port, 'GET', undefined, undefined, differentBucket)).status, 200);
        } finally {
          store.shutdown();
          await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
        }
      });
    }
  });
}
