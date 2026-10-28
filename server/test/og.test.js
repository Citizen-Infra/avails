import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildOgDescription, clearOgCache, injectOg, pollOgHandler } from '../src/lib/og.js';

const template = fs.readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8');
const image = 'https://avails.citizeninfra.org/og-image-open-index.png';
function meta(html, key) {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]);
  const matches = tags.filter(tag => new RegExp(`(?:name|property)="${key}"`).test(tag));
  assert.equal(matches.length, 1, `one ${key} tag`);
  return matches[0].match(/content="([^"]*)"/)[1];
}

test('homepage shares one landscape cover through OG and Twitter metadata', () => {
  assert.equal(meta(template, 'og:site_name'), 'Avails');
  assert.equal(meta(template, 'og:image'), image);
  assert.equal(meta(template, 'twitter:image'), image);
  assert.equal(meta(template, 'twitter:card'), 'summary_large_image');
  assert.equal(meta(template, 'og:image:type'), 'image/png');
  assert.equal(meta(template, 'og:image:width'), '1200');
  assert.equal(meta(template, 'og:image:height'), '630');
  assert.equal(meta(template, 'og:image:alt'), meta(template, 'twitter:image:alt'));
});

test('poll text updates OG, Twitter and document metadata without personalizing the cover', () => {
  const out = injectOg(template, { title: 'Example planning — Avails', description: 'Choose a time together.', url: 'https://example.test/p/fixture' });
  assert.ok(out.includes('<title>Example planning — Avails</title>'));
  for (const key of ['og:title', 'twitter:title']) assert.equal(meta(out, key), 'Example planning — Avails');
  for (const key of ['description', 'og:description', 'twitter:description']) assert.equal(meta(out, key), 'Choose a time together.');
  assert.equal(meta(out, 'og:url'), 'https://example.test/p/fixture');
  for (const key of ['og:image', 'twitter:image']) assert.equal(meta(out, key), image);
});

test('authored HTML and replacement tokens stay escaped and literal in both metadata families', () => {
  const title = 'Example $& <script> & "quoted"';
  const description = "Literal $` and $' <b> & text";
  const out = injectOg(template, { title, description, url: 'https://example.test/?one=1&two=2' });
  const safeTitle = 'Example $&amp; &lt;script&gt; &amp; &quot;quoted&quot;';
  const safeDescription = 'Literal $` and $&#39; &lt;b&gt; &amp; text';
  for (const key of ['og:title', 'twitter:title']) assert.equal(meta(out, key), safeTitle);
  for (const key of ['description', 'og:description', 'twitter:description']) assert.equal(meta(out, key), safeDescription);
  assert.ok(out.includes(`<title>${safeTitle}</title>`));
  assert.equal(meta(out, 'og:url'), 'https://example.test/?one=1&amp;two=2');
});

test('an explicit legacy image override updates OG and Twitter together', () => {
  const out = injectOg(template, { title: 'Example', description: 'Example', url: 'https://example.test/', image: 'https://example.test/cover.png?a=1&b=2' });
  for (const key of ['og:image', 'twitter:image']) assert.equal(meta(out, key), 'https://example.test/cover.png?a=1&amp;b=2');
});

test('authored descriptions retain priority and are clamped without adding response state', () => {
  const poll = { description: '  Public authored copy.  ', dates: ['2026-11-02'], responseCount: 19, responses: [{ name: 'PRIVATE_RESPONSE_MARKER' }], hideResponsesUntilSubmit: true };
  assert.equal(buildOgDescription(poll), 'Public authored copy.');
  const long = buildOgDescription({ ...poll, description: 'a'.repeat(250) });
  assert.equal(long.length, 198);
  assert.ok(long.endsWith('…'));
  assert.doesNotMatch(long, /PRIVATE_RESPONSE_MARKER|19/);
});

test('date/time fallback remains timezone-labelled and independent of response counts', () => {
  const description = buildOgDescription({ dates: ['2026-11-02', '2026-11-03'], timeRange: { start: '09:00', end: '12:00' }, timezone: 'UTC', responseCount: 19 });
  assert.equal(description, 'Mon Nov 2, Tue Nov 3 · 09:00–12:00 UTC');
  assert.doesNotMatch(description, /responses|19/);
});

function handlerFixture(t) {
  const base = path.join(os.tmpdir(), 'opencode'); fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'avails-og-test-'));
  fs.writeFileSync(path.join(dir, 'index.html'), template);
  const originalFetch = globalThis.fetch;
  clearOgCache();
  t.after(() => { globalThis.fetch = originalFetch; clearOgCache(); fs.rmSync(dir, { recursive: true, force: true }); });
  const request = { params: { did: 'did:plc:metadatafixture', rkey: 'example' }, protocol: 'https', get: key => key === 'host' ? 'avails.example.test' : undefined };
  const response = () => ({ code: 200, contentType: null, body: null, status(code) { this.code = code; return this; }, type(value) { this.contentType = value; return this; }, send(value) { this.body = value; return this; } });
  return { dir, request, response };
}

test('poll handler emits crawler-readable text and a shared image using synthetic PDS data only', async t => {
  const f = handlerFixture(t); const calls = [];
  const poll = { title: 'Example $& planning', description: 'Public planning description.', responseCount: 19, hideResponsesUntilSubmit: true, responses: [{ name: 'PRIVATE_RESPONSE_MARKER', slots: ['PRIVATE_SLOT_MARKER'] }] };
  globalThis.fetch = async (url, options) => {
    calls.push(url); assert.ok(options.signal);
    if (url.startsWith('https://plc.directory/')) return Response.json({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example.test' }] });
    assert.ok(url.startsWith('https://pds.example.test/xrpc/com.atproto.repo.getRecord?'));
    return Response.json({ value: poll });
  };
  const handler = pollOgHandler(f.dir), res = f.response();
  await handler(f.request, res);
  assert.equal(res.code, 200); assert.equal(res.contentType, 'html');
  for (const key of ['og:title', 'twitter:title']) assert.equal(meta(res.body, key), 'Example $&amp; planning — Avails');
  for (const key of ['og:description', 'twitter:description']) assert.equal(meta(res.body, key), poll.description);
  for (const key of ['og:image', 'twitter:image']) assert.equal(meta(res.body, key), image);
  assert.equal(meta(res.body, 'og:url'), 'https://avails.example.test/p/did%3Aplc%3Ametadatafixture/example');
  assert.doesNotMatch(res.body, /PRIVATE_RESPONSE_MARKER|PRIVATE_SLOT_MARKER|19 responses/);
  await handler(f.request, f.response());
  assert.equal(calls.length, 2, 'existing poll cache prevents repeated resolver/PDS reads');
});

test('unknown or unavailable polls retain the generic branded preview without a live lookup', async t => {
  const f = handlerFixture(t); let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 404 }); };
  const res = f.response(); await pollOgHandler(f.dir)(f.request, res);
  assert.equal(res.body, template); assert.equal(calls, 1);
});

test('network failure falls back to the generic cover', async t => {
  const f = handlerFixture(t);
  globalThis.fetch = async () => { throw new Error('Synthetic unavailable PDS'); };
  const res = f.response(); await pollOgHandler(f.dir)(f.request, res);
  assert.equal(res.body, template);
});

test('missing build returns the existing 404 without trying a PDS', async t => {
  const f = handlerFixture(t); fs.unlinkSync(path.join(f.dir, 'index.html'));
  globalThis.fetch = () => assert.fail('No PDS request without a template');
  const res = f.response(); await pollOgHandler(f.dir)(f.request, res);
  assert.equal(res.code, 404); assert.equal(res.body, 'index.html not found');
});
