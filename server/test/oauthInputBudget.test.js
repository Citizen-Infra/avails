import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { gzipSync, deflateSync } from 'node:zlib';
import {
  OAUTH_INPUT_LIMITS, OAuthInputBudgetError,
  checkOAuthJsonBudget, createOAuthBudgetFetch,
} from '../src/lib/oauthInputBudget.js';

const url = 'https://issuer.example.invalid/metadata';
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const small = { bytes: 256, collection: 8, depth: 4, tokens: 32, timeoutMs: 1000 };
const budgetError = error => error instanceof OAuthInputBudgetError && error.code === 'OAUTH_INPUT_BUDGET' && error.status === 502;

describe('OAuth JSON lexical budget preflight', () => {
  it('ignores escaped quotes, delimiters and braces within strings', () => {
    const value = { text: '" \\ \\" ] [ { } , :', array: [true, false, null, 0, -2.5e3] };
    checkOAuthJsonBudget(JSON.stringify(value), { ...small, collection: 5 });
    checkOAuthJsonBudget('\ufeff' + JSON.stringify(value), { ...small, collection: 5 });
  });

  it('accepts exact array and depth limits and rejects the next item before parsing', () => {
    checkOAuthJsonBudget('[0,1,2,3]', { ...small, collection: 4 });
    assert.throws(() => checkOAuthJsonBudget('[0,1,2,3,4]', { ...small, collection: 4 }), budgetError);
    checkOAuthJsonBudget('[[[[0]]]]', small);
    assert.throws(() => checkOAuthJsonBudget('[[[[[0]]]]]', small), budgetError);
  });

  it('counts object members, duplicate keys and nested collections', () => {
    checkOAuthJsonBudget('{"a":0,"b":1}', { ...small, collection: 2 });
    assert.throws(() => checkOAuthJsonBudget('{"a":0,"a":1,"a":2}', { ...small, collection: 2 }), budgetError);
    assert.throws(() => checkOAuthJsonBudget('{"outer":[[0,1,2]]}', { ...small, collection: 2 }), budgetError);
  });

  it('bounds total lexical tokens across individually small collections', () => {
    checkOAuthJsonBudget('{"a":0}', { ...small, tokens: 3 });
    assert.throws(() => checkOAuthJsonBudget('{"a":0,"b":1}', { ...small, tokens: 4 }), budgetError);
  });

  it('rejects the evaluated issue-amplification shape with production limits', () => {
    assert.throws(() => checkOAuthJsonBudget(JSON.stringify({ scopes_supported: Array(1025).fill(0) })), budgetError);
    checkOAuthJsonBudget(JSON.stringify({ scopes_supported: Array.from({ length: 512 }, (_, i) => `scope-${i}`) }));
  });

  it('agrees with independent object-graph counts for deterministic escaped/nested fixtures', () => {
    let seed = 7;
    const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    const strings = ['a', '" \\ \\" ] [ { } , :', '\u263a', '\n\t', '\ufeff'];
    function value(depth) {
      if (!depth || random(3) === 0) return [null, false, 12.5, strings[random(strings.length)]][random(4)];
      if (random(2)) return Array.from({ length: 1 + random(4) }, () => value(depth - 1));
      return Object.fromEntries(Array.from({ length: 1 + random(4) }, (_, i) => [`${strings[random(strings.length)]}${i}`, value(depth - 1)]));
    }
    function measure(value, depth = 0) {
      if (!value || typeof value !== 'object') return { tokens: 1, collection: 0, depth };
      const entries = Object.entries(value), objectKeys = !Array.isArray(value);
      const result = { tokens: 1 + (objectKeys ? entries.length : 0), collection: entries.length, depth: depth + 1 };
      for (const [, child] of entries) {
        const next = measure(child, depth + 1);
        result.tokens += next.tokens;
        result.collection = Math.max(result.collection, next.collection);
        result.depth = Math.max(result.depth, next.depth);
      }
      return result;
    }
    for (let i = 0; i < 128; i++) {
      const data = { fixture: value(4) }, text = JSON.stringify(data), measured = measure(data);
      checkOAuthJsonBudget(text, measured);
      for (const dimension of ['tokens', 'collection', 'depth']) {
        assert.throws(() => checkOAuthJsonBudget(text, { ...measured, [dimension]: measured[dimension] - 1 }), budgetError);
      }
    }
  });
});

describe('OAuth response budget transport', () => {
  it('preserves bytes, HTTP metadata, headers and clone behavior', async () => {
    const original = json({ value: '\u263a [not a collection]' });
    Object.defineProperties(original, {
      url: { value: 'https://issuer.example.invalid/final' }, redirected: { value: true }, type: { value: 'basic' },
    });
    original.headers.set('DPoP-Nonce', 'synthetic-nonce');
    const response = await createOAuthBudgetFetch(async () => original, small)(url);
    const clone = response.clone();
    for (const result of [response, clone, clone.clone()]) {
      assert.equal(result.url, original.url);
      assert.equal(result.redirected, true);
      assert.equal(result.type, 'basic');
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('DPoP-Nonce'), 'synthetic-nonce');
      assert.deepEqual(await result.json(), { value: '\u263a [not a collection]' });
    }
  });

  it('preserves status/statusText and does not consume a bodyless response', async () => {
    const original = new Response(null, { status: 204, statusText: 'No Content' });
    const response = await createOAuthBudgetFetch(async () => original, small)(url);
    assert.equal(response, original);
    assert.equal(response.statusText, 'No Content');
  });

  it('passes request method, body, headers and redirect settings exactly once', async () => {
    let calls = 0;
    const input = new Request(url, { method: 'POST', body: 'grant_type=refresh_token', redirect: 'manual', headers: { DPoP: 'synthetic-proof' } });
    const fetch = createOAuthBudgetFetch(async (request, init) => {
      calls++;
      const effective = new Request(request, init);
      assert.equal(effective.method, 'POST');
      assert.equal(effective.redirect, 'manual');
      assert.equal(effective.headers.get('DPoP'), 'synthetic-proof');
      assert.equal(await effective.text(), 'grant_type=refresh_token');
      return json({ ok: true });
    }, small);
    await fetch(input);
    assert.equal(calls, 1);
  });

  for (const declared of [undefined, '1', 'invalid']) {
    it(`counts streamed bytes despite ${declared === undefined ? 'missing' : declared} Content-Length`, async () => {
      let cancelled = 0, pulls = 0;
      const body = new ReadableStream({
        pull(controller) { pulls++; controller.enqueue(new Uint8Array(40)); },
        cancel() { cancelled++; },
      });
      const fetch = createOAuthBudgetFetch(async () => new Response(body, { headers: declared === undefined ? {} : { 'content-length': declared } }), { ...small, bytes: 64 });
      await assert.rejects(fetch(url), budgetError);
      assert.equal(cancelled, 1);
      assert.ok(pulls <= 3);
      assert.equal(body.locked, false);
    });
  }

  it('rejects an excessive declared length without reading the body', async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    await assert.rejects(createOAuthBudgetFetch(async () => new Response(body, { headers: { 'content-length': '999' } }), small)(url), budgetError);
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  });

  it('accepts the exact byte budget and counts UTF-8 bytes, not characters', async () => {
    const value = JSON.stringify({ text: 'éé' });
    const bytes = Buffer.byteLength(value);
    await createOAuthBudgetFetch(async () => new Response(value), { ...small, bytes })(url);
    await assert.rejects(createOAuthBudgetFetch(async () => new Response(value), { ...small, bytes: bytes - 1 })(url), budgetError);
  });

  it('handles tiny and empty chunks without retaining per-chunk buffers', async () => {
    const bytes = Buffer.from('{"text":"éé"}');
    let index = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (index === bytes.length) return controller.close();
        controller.enqueue(new Uint8Array(0));
        controller.enqueue(bytes.subarray(index, ++index));
      },
    });
    const result = await createOAuthBudgetFetch(async () => new Response(body, { headers: { 'content-type': 'application/json' } }), { ...small, bytes: bytes.length })(url);
    assert.deepEqual(await result.json(), { text: 'éé' });
  });

  it('scans JSON media types before returning data to the SDK', async () => {
    for (const type of ['application/json; charset=utf-8', 'application/did+ld+json', 'Application/Problem+JSON']) {
      const response = () => new Response('[0,0,0,0,0,0,0,0,0]', { headers: { 'content-type': type } });
      await assert.rejects(createOAuthBudgetFetch(async () => response(), small)(url), budgetError);
    }
  });

  it('leaves JSON syntax errors to the SDK parser and handles text responses unchanged', async () => {
    const malformed = await createOAuthBudgetFetch(async () => new Response('{invalid', { headers: { 'content-type': 'application/json' } }), small)(url);
    await assert.rejects(malformed.json(), SyntaxError);
    const text = await createOAuthBudgetFetch(async () => new Response('did:plc:fixture [not JSON]'), small)(url);
    assert.equal(await text.text(), 'did:plc:fixture [not JSON]');
  });

  it('propagates caller cancellation during a stalled body and releases its reader', { timeout: 2000 }, async () => {
    const caller = new AbortController();
    const reason = new Error('Synthetic caller cancellation');
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const promise = createOAuthBudgetFetch(async () => new Response(body), small)(url, { signal: caller.signal });
    await new Promise(resolve => setImmediate(resolve));
    caller.abort(reason);
    await assert.rejects(promise, error => error === reason);
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  });

  it('enforces its deadline for a stalled body without waiting on cancellation', { timeout: 2000 }, async () => {
    const body = new ReadableStream({ cancel() { return new Promise(() => {}); } });
    await assert.rejects(createOAuthBudgetFetch(async () => new Response(body), { ...small, timeoutMs: 20 })(url), budgetError);
    assert.equal(body.locked, false);
  });

  it('propagates an already-aborted caller without issuing a request', async () => {
    const caller = new AbortController();
    caller.abort();
    await assert.rejects(createOAuthBudgetFetch(async () => assert.fail('Unexpected request'), small)(new Request(url, { signal: caller.signal })), error => error.name === 'AbortError');
  });

  it('cancels a response arriving after the caller aborts', async () => {
    const caller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const fetch = createOAuthBudgetFetch(async () => { caller.abort(); return new Response(body); }, small);
    await assert.rejects(fetch(url, { signal: caller.signal }), error => error.name === 'AbortError');
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  });

  it('clears its own deadline once a response is buffered', async () => {
    let signal;
    await createOAuthBudgetFetch(async (input, init) => { signal = init.signal; return json({ ok: true }); }, { ...small, timeoutMs: 10 })(url);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(signal.aborted, false);
  });

  it('retains transport failures without retries or URL/body data in budget errors', async () => {
    const error = new Error('Synthetic network failure');
    let calls = 0;
    await assert.rejects(createOAuthBudgetFetch(async () => { calls++; throw error; }, small)(url), cause => cause === error);
    assert.equal(calls, 1);
    assert.doesNotMatch(new OAuthInputBudgetError('collection').message, /example|token=/);
    assert.throws(() => createOAuthBudgetFetch(async () => {}, { bytes: Infinity }), TypeError);
  });

  it('counts decoded gzip/deflate response bytes with native fetch', { timeout: 5000 }, async () => {
    const payload = Buffer.from(JSON.stringify({ text: 'x'.repeat(8192) }));
    const server = createServer((req, res) => {
      if (req.url === '/stall') return;
      const encoding = req.url.slice(1);
      const body = encoding === 'gzip' ? gzipSync(payload) : deflateSync(payload);
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': encoding, 'content-length': body.length });
      res.end(body);
    }).listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      for (const encoding of ['gzip', 'deflate']) {
        await assert.rejects(createOAuthBudgetFetch(globalThis.fetch, { ...small, bytes: 256 })(`http://127.0.0.1:${server.address().port}/${encoding}`), budgetError);
      }
      await assert.rejects(createOAuthBudgetFetch(globalThis.fetch, { ...small, timeoutMs: 20 })(`http://127.0.0.1:${server.address().port}/stall`), budgetError);
    } finally {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  });
});
