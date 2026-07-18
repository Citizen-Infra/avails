# Service-Repo Reliability Pass (#42 Stage 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop writing poll responses through the *creator's* OAuth session. Give avails its own ATProto service identity and write all new responses to its own repo, so a response no longer depends on the creator being signed in — deleting the 503 failure class (#72, #117) and the "anonymous responses require creator's session" hard constraint.

**Architecture:** A new `serviceSession.js` logs avails into a dedicated ATProto account via app-password (`com.atproto.server.createSession` + refresh loop) and exposes authenticated XRPC writes. The response write routes (`responses.js`) write to the **service repo** instead of the creator's. Reads (`polls.js`, 3 sites) merge two public `listRecords` — the creator repo (legacy responses only) and the service repo (all new responses) — filtered by `pollUri`, tagging each with its home. **The entire new path is gated behind `isServiceConfigured()`**: when the service env vars are absent, every route falls back to today's exact creator-session behavior. So the PR merges and deploys as a no-op; setting two env vars activates it.

**Tech Stack:** Express 4 (ES modules, `server/`), raw ATProto XRPC over `fetch` (the repo has **no** `@atproto/api` dependency — do not add one), Node built-in test runner (`node:test`, `--experimental-test-module-mocks`).

**Source of truth:** Citizen-Infra/avails#42 (design-resolution comment, 2026-07-18) + #77 (did:plc service identity). This is Stage 1 only — authenticated respondents writing to *their own* PDS (Stage 2) and private-scope responses are explicitly out of scope (see #42).

## Global Constraints

- **No `@atproto/api`.** Use raw XRPC over `fetch`, mirroring `responses.js` / `tools.js`. Adding the SDK is out of scope.
- **The new path is feature-flagged, always.** Every write/read branch checks `isServiceConfigured()`. Configured → service path. Not configured → the current creator-session code, byte-for-byte in behavior. This is what lets the PR deploy before the account exists. Never remove the fallback in this PR.
- **Reads are public and unauthenticated.** `listRecords` against any repo needs no auth. The read path must NOT depend on the service *login* succeeding — only on knowing the service DID (resolved + cached from the handle). If service identity resolution fails, degrade to creator-repo responses only; never 503 a read.
- **Full cursor paging on the service-repo read.** The service repo accumulates responses across *all* polls, so a single `limit=100` call can miss a poll's responses once the repo exceeds 100 records total. Page with `cursor` until exhausted, with a sane page cap; if the cap is hit, `console.warn` — never silently truncate.
- **Record shape is unchanged.** The response record still carries `pollUri: at://<creatorDid>/chat.avails.scheduling.poll/<rkey>`, so it is self-describing regardless of which repo holds it. The read filter (`pollUri` matches this poll) works across both repos identically.
- **Tests:** `node:test` + `node:assert`; the suite globs `test/*.test.js` (a new test file is gated automatically — never edit `package.json`). Mock the service layer the way `test/responses.test.js` mocks the session layer. Syntax check: `node --check server/src/<file>.js`.
- **No behavior change to poll create/finalize/unschedule.** Those write the *creator's own* records with the creator's session when the creator is present — that coupling is correct and stays. Only the response write path and the response *read merge* change.

---

## The activation model (read before Task 1)

`isServiceConfigured()` is true iff `AVAILS_SERVICE_IDENTIFIER` and `AVAILS_SERVICE_APP_PASSWORD` are both set. This single predicate governs the whole change:

| | `isServiceConfigured()` false (today, and post-deploy pre-provision) | true (after env vars set) |
|---|---|---|
| **POST response** | creator session → creator repo (current code; 503 if creator signed out) | service session → service repo (no 503) |
| **PUT/DELETE response** | creator session → creator repo | service `getRecord` to disambiguate: in service repo → service session; else → creator session (legacy, may 503) |
| **Read merge** | creator repo only (current code) | creator repo (legacy) + service repo (new), merged |

Consequence for sequencing: **the code ships dark.** Merge + deploy changes nothing. Provisioning the account and setting the two env vars is the activation switch, reversible by unsetting them. The real-PDS smoke (Task 6) happens after activation.

---

## File Structure

**Create:**
- `server/src/lib/serviceSession.js` — service identity: `isServiceConfigured()`, `getServiceIdentity()` (resolve+cache did/pds), authenticated `serviceCreateRecord`/`servicePutRecord`/`serviceDeleteRecord`/`serviceGetRecord` with refresh+re-login.
- `server/src/lib/responseReads.js` — `fetchPollResponses(creatorDid, rkey)`: public paged read of creator repo + service repo, filtered by `pollUri`, each tagged `{ home: 'creator' | 'service' }`.
- `server/test/serviceSession.test.js`, `server/test/responseReads.test.js`.

**Modify:**
- `server/src/routes/responses.js` — branch POST/PUT/DELETE on `isServiceConfigured()`.
- `server/src/routes/polls.js` — replace the three inline response-read blocks (lines ~136, ~248, ~344) with `fetchPollResponses`.
- `server/test/responses.test.js` — update for the branched write path (the 503-only-when-not-configured case; the service-write case).
- `docs/architecture.md`, `CLAUDE.md` — service-identity section; delete the "anonymous responses require creator's session" hard constraint; env vars.

---

## Task 1: Service session module

**Files:**
- Create: `server/src/lib/serviceSession.js`
- Test: `server/test/serviceSession.test.js`

**Interfaces:**
- Produces:
  - `isServiceConfigured(): boolean` — both env vars present.
  - `async getServiceIdentity(): { did, pds }` — resolves the identifier's DID + PDS endpoint (public), cached module-level. Throws if not configured.
  - `async serviceCreateRecord(collection, record): { uri, cid }`
  - `async servicePutRecord(collection, rkey, record): { uri, cid }`
  - `async serviceDeleteRecord(collection, rkey): void`
  - `async serviceGetRecord(collection, rkey): object | null` — null on 404 (used to disambiguate service vs legacy).
- Consumes: `globalThis.fetch` only.

- [ ] **Step 1: Write the failing test**

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// serviceSession caches identity + tokens at module scope; import fresh per concern
// via a query-string cache-bust so each test starts clean.
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

test('isServiceConfigured reflects both env vars', async () => {
  const mod = await import('../src/lib/serviceSession.js?case=cfg');
  delete process.env.AVAILS_SERVICE_IDENTIFIER;
  delete process.env.AVAILS_SERVICE_APP_PASSWORD;
  assert.equal(mod.isServiceConfigured(), false);
  process.env.AVAILS_SERVICE_IDENTIFIER = 'avails.zhgnv.com';
  process.env.AVAILS_SERVICE_APP_PASSWORD = 'app-pw';
  assert.equal(mod.isServiceConfigured(), true);
});

test('serviceCreateRecord logs in once, then writes with the access token', async () => {
  process.env.AVAILS_SERVICE_IDENTIFIER = 'avails.zhgnv.com';
  process.env.AVAILS_SERVICE_APP_PASSWORD = 'app-pw';
  process.env.AVAILS_SERVICE_PDS = 'https://pds.test';
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); calls.push(u);
    if (u.includes('com.atproto.server.createSession')) {
      return { ok: true, json: async () => ({ accessJwt: 'A1', refreshJwt: 'R1', did: 'did:plc:svc' }) };
    }
    if (u.includes('com.atproto.repo.createRecord')) {
      assert.equal(opts.headers.Authorization, 'Bearer A1');
      return { ok: true, json: async () => ({ uri: 'at://did:plc:svc/c/xyz', cid: 'cid1' }) };
    }
    throw new Error(`unexpected ${u}`);
  };
  const mod = await import('../src/lib/serviceSession.js?case=create');
  const r = await mod.serviceCreateRecord('chat.avails.scheduling.response', { pollUri: 'at://x/y/z' });
  assert.equal(r.uri, 'at://did:plc:svc/c/xyz');
  assert.equal(calls.filter((c) => c.includes('createSession')).length, 1);
});

test('an expired access token triggers refresh then retry', async () => {
  process.env.AVAILS_SERVICE_IDENTIFIER = 'avails.zhgnv.com';
  process.env.AVAILS_SERVICE_APP_PASSWORD = 'app-pw';
  process.env.AVAILS_SERVICE_PDS = 'https://pds.test';
  let wrote = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('createSession')) return { ok: true, json: async () => ({ accessJwt: 'A1', refreshJwt: 'R1', did: 'did:plc:svc' }) };
    if (u.includes('refreshSession')) {
      assert.equal(opts.headers.Authorization, 'Bearer R1');
      return { ok: true, json: async () => ({ accessJwt: 'A2', refreshJwt: 'R2', did: 'did:plc:svc' }) };
    }
    if (u.includes('createRecord')) {
      if (opts.headers.Authorization === 'Bearer A1') {
        return { ok: false, status: 400, json: async () => ({ error: 'ExpiredToken' }), text: async () => 'ExpiredToken' };
      }
      assert.equal(opts.headers.Authorization, 'Bearer A2'); wrote++;
      return { ok: true, json: async () => ({ uri: 'at://did:plc:svc/c/ok', cid: 'c' }) };
    }
    throw new Error(`unexpected ${u}`);
  };
  const mod = await import('../src/lib/serviceSession.js?case=refresh');
  const r = await mod.serviceCreateRecord('c', { pollUri: 'p' });
  assert.equal(r.uri, 'at://did:plc:svc/c/ok');
  assert.equal(wrote, 1);
});

test('serviceGetRecord returns null on 404', async () => {
  process.env.AVAILS_SERVICE_IDENTIFIER = 'avails.zhgnv.com';
  process.env.AVAILS_SERVICE_APP_PASSWORD = 'app-pw';
  process.env.AVAILS_SERVICE_PDS = 'https://pds.test';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('createSession')) return { ok: true, json: async () => ({ accessJwt: 'A1', refreshJwt: 'R1', did: 'did:plc:svc' }) };
    if (u.includes('getRecord')) return { ok: false, status: 404, text: async () => 'not found' };
    throw new Error(`unexpected ${u}`);
  };
  const mod = await import('../src/lib/serviceSession.js?case=get404');
  assert.equal(await mod.serviceGetRecord('c', 'missing'), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && node --test test/serviceSession.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// server/src/lib/serviceSession.js
// avails' own ATProto identity. Writes poll responses to avails' own repo so a
// response no longer depends on the creator's OAuth session (#42). App-password
// auth (createSession/refreshSession) — NOT OAuth; this is a headless service
// credential, not a user grant. Feature-flagged: when the env vars are absent,
// callers fall back to the legacy creator-session path.

const IDENTIFIER = () => process.env.AVAILS_SERVICE_IDENTIFIER;
const APP_PASSWORD = () => process.env.AVAILS_SERVICE_APP_PASSWORD;
const CONFIGURED_PDS = () => process.env.AVAILS_SERVICE_PDS; // optional override

export function isServiceConfigured() {
  return Boolean(IDENTIFIER() && APP_PASSWORD());
}

let identity = null;   // { did, pds }
let tokens = null;     // { accessJwt, refreshJwt }

async function resolvePdsForDid(did) {
  const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
  if (!res.ok) throw new Error(`resolve PDS for ${did}: ${res.status}`);
  const doc = await res.json();
  const svc = doc.service?.find((s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
  return svc?.serviceEndpoint || 'https://bsky.social';
}

// The host we call createSession against IS the account's PDS. Prefer an explicit
// AVAILS_SERVICE_PDS; else default to bsky.social for login, then trust the DID's
// resolved PDS for reads/writes.
function loginHost() {
  return CONFIGURED_PDS() || 'https://bsky.social';
}

async function login() {
  if (!isServiceConfigured()) throw new Error('service identity not configured');
  const res = await fetch(`${loginHost()}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: IDENTIFIER(), password: APP_PASSWORD() }),
  });
  if (!res.ok) throw new Error(`service login failed: ${res.status} ${await res.text().catch(() => '')}`);
  const data = await res.json();
  tokens = { accessJwt: data.accessJwt, refreshJwt: data.refreshJwt };
  identity = { did: data.did, pds: CONFIGURED_PDS() || (await resolvePdsForDid(data.did)) };
  return identity;
}

export async function getServiceIdentity() {
  if (identity) return identity;
  return login();
}

async function refresh() {
  const res = await fetch(`${loginHost()}/xrpc/com.atproto.server.refreshSession`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.refreshJwt}` },
  });
  if (!res.ok) { await login(); return; }        // refresh dead → full re-login
  const data = await res.json();
  tokens = { accessJwt: data.accessJwt, refreshJwt: data.refreshJwt };
}

// Authenticated XRPC POST against the service PDS, refreshing+retrying once on an
// expired/invalid token.
async function authedXrpc(method, body, { retry = true } = {}) {
  const id = await getServiceIdentity();
  if (!tokens) await login();
  const doCall = () => fetch(`${id.pds}/xrpc/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.accessJwt}` },
    body: JSON.stringify(body),
  });
  let res = await doCall();
  if (!res.ok && retry) {
    const text = await res.text().catch(() => '');
    if (res.status === 400 || res.status === 401) {
      if (/ExpiredToken|InvalidToken|AuthenticationRequired/i.test(text)) {
        await refresh();
        res = await doCall();
      } else {
        throw new Error(`${method} failed (${res.status}): ${text}`);
      }
    } else {
      throw new Error(`${method} failed (${res.status}): ${text}`);
    }
  }
  if (!res.ok) throw new Error(`${method} failed (${res.status}): ${await res.text().catch(() => '')}`);
  return res.json();
}

export async function serviceCreateRecord(collection, record) {
  const { did } = await getServiceIdentity();
  return authedXrpc('com.atproto.repo.createRecord', { repo: did, collection, record });
}

export async function servicePutRecord(collection, rkey, record) {
  const { did } = await getServiceIdentity();
  return authedXrpc('com.atproto.repo.putRecord', { repo: did, collection, rkey, record });
}

export async function serviceDeleteRecord(collection, rkey) {
  const { did } = await getServiceIdentity();
  await authedXrpc('com.atproto.repo.deleteRecord', { repo: did, collection, rkey });
}

// Public read against the service repo — no auth needed, but we reuse the resolved
// PDS. Returns null on 404 so callers can disambiguate a service record from a
// legacy creator-repo one.
export async function serviceGetRecord(collection, rkey) {
  const { did, pds } = await getServiceIdentity();
  const url = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getRecord failed (${res.status})`);
  return res.json();
}

// Test-only: reset cached identity/tokens.
export function __resetForTest() { identity = null; tokens = null; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && node --test test/serviceSession.test.js`
Expected: PASS (4 tests). Then `node --check server/src/lib/serviceSession.js`.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/serviceSession.js server/test/serviceSession.test.js
git commit -m "feat(service): app-password ATProto service identity for response writes (#42)"
```

---

## Task 2: Shared response-read helper (creator + service merge)

**Files:**
- Create: `server/src/lib/responseReads.js`
- Test: `server/test/responseReads.test.js`

**Interfaces:**
- Produces: `async fetchPollResponses(creatorDid, rkey): Array<{ ...responseValue, uri, cid, home }>` — merges the creator repo (legacy) and, when `isServiceConfigured()`, the service repo, each `listRecords` paged to exhaustion and filtered to `pollUri` ending in `/<rkey>`. `home` is `'creator'` or `'service'`.
- Consumes: a shared `resolvePds` (extract the copy in `responses.js`/`polls.js` or duplicate — a 6-line helper; do not over-abstract), `getServiceIdentity`/`isServiceConfigured` from Task 1.

- [ ] **Step 1: Write the failing test** — mock `globalThis.fetch`: creator repo returns one legacy response for this poll (+ one for a different poll, which must be filtered out); service repo (when configured) returns two, one across a cursor page boundary. Assert: correct count, `home` tags, cross-poll filtering, both pages included.

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
beforeEach(() => { process.env = { ...originalEnv }; globalThis.fetch = originalFetch; });

test('merges creator (legacy) + service responses, tags home, filters by poll, pages', async () => {
  process.env.AVAILS_SERVICE_IDENTIFIER = 'avails.zhgnv.com';
  process.env.AVAILS_SERVICE_APP_PASSWORD = 'pw';
  process.env.AVAILS_SERVICE_PDS = 'https://svc.pds';
  const CREATOR = 'did:plc:creator';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('plc.directory')) return { ok: true, json: async () => ({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://creator.pds' }] }) };
    if (u.includes('createSession')) return { ok: true, json: async () => ({ accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:svc' }) };
    if (u.includes('creator.pds') && u.includes('listRecords')) {
      return { ok: true, json: async () => ({ records: [
        { uri: 'at://c/r/leg1', cid: 'c1', value: { pollUri: `at://${CREATOR}/p/poll1`, name: 'Legacy' } },
        { uri: 'at://c/r/other', cid: 'c9', value: { pollUri: `at://${CREATOR}/p/OTHER`, name: 'Nope' } },
      ] }) };
    }
    if (u.includes('svc.pds') && u.includes('listRecords')) {
      if (!u.includes('cursor=')) return { ok: true, json: async () => ({ cursor: 'pg2', records: [
        { uri: 'at://s/r/s1', cid: 's1', value: { pollUri: `at://${CREATOR}/p/poll1`, name: 'New1' } },
      ] }) };
      return { ok: true, json: async () => ({ records: [
        { uri: 'at://s/r/s2', cid: 's2', value: { pollUri: `at://${CREATOR}/p/poll1`, name: 'New2' } },
      ] }) };
    }
    throw new Error(`unexpected ${u}`);
  };
  const { fetchPollResponses } = await import('../src/lib/responseReads.js?case=merge');
  const out = await fetchPollResponses(CREATOR, 'poll1');
  const names = out.map((r) => r.name).sort();
  assert.deepEqual(names, ['Legacy', 'New1', 'New2']);
  assert.equal(out.find((r) => r.name === 'Legacy').home, 'creator');
  assert.equal(out.find((r) => r.name === 'New2').home, 'service');
});

test('when service not configured, returns creator responses only', async () => {
  delete process.env.AVAILS_SERVICE_IDENTIFIER;
  delete process.env.AVAILS_SERVICE_APP_PASSWORD;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('plc.directory')) return { ok: true, json: async () => ({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://creator.pds' }] }) };
    if (u.includes('listRecords')) return { ok: true, json: async () => ({ records: [
      { uri: 'at://c/r/1', cid: 'c1', value: { pollUri: 'at://did:plc:creator/p/poll1', name: 'Only' } },
    ] }) };
    throw new Error(`unexpected ${u}`);
  };
  const { fetchPollResponses } = await import('../src/lib/responseReads.js?case=nocfg');
  const out = await fetchPollResponses('did:plc:creator', 'poll1');
  assert.deepEqual(out.map((r) => r.name), ['Only']);
});
```

- [ ] **Step 2: Run → FAIL.** `cd server && node --test test/responseReads.test.js`

- [ ] **Step 3: Implement**

```js
// server/src/lib/responseReads.js
import { isServiceConfigured, getServiceIdentity } from './serviceSession.js';

const RESPONSE_COLLECTION = 'chat.avails.scheduling.response';
const MAX_PAGES = 20; // 20 * 100 = 2000 records; warn if exceeded rather than truncate silently

async function resolvePds(did) {
  const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
  if (!res.ok) throw new Error(`resolve PDS ${did}: ${res.status}`);
  const doc = await res.json();
  const svc = doc.service?.find((s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
  return svc?.serviceEndpoint || 'https://bsky.social';
}

// Page listRecords on `repo`@`pds` for the response collection, keeping records
// whose pollUri belongs to `rkey`. Public/unauthenticated.
async function pagedResponses(pds, repo, rkey, home) {
  const out = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(repo)}&collection=${encodeURIComponent(RESPONSE_COLLECTION)}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) break;                       // a down repo yields no rows, never throws a read
    const data = await res.json();
    for (const r of data.records || []) {
      if (r.value?.pollUri && r.value.pollUri.endsWith(`/${rkey}`)) {
        out.push({ ...r.value, uri: r.uri, cid: r.cid, home });
      }
    }
    cursor = data.cursor;
    if (!cursor) return out;
  }
  console.warn(`[responseReads] hit MAX_PAGES for ${repo} poll ${rkey} — response list may be truncated`);
  return out;
}

// All responses for a poll, from the creator repo (legacy) + the service repo (new).
export async function fetchPollResponses(creatorDid, rkey) {
  const results = [];
  try {
    const creatorPds = await resolvePds(creatorDid);
    results.push(...await pagedResponses(creatorPds, creatorDid, rkey, 'creator'));
  } catch (err) {
    console.warn(`[responseReads] creator repo read failed for ${creatorDid}:`, err.message);
  }
  if (isServiceConfigured()) {
    try {
      const { did, pds } = await getServiceIdentity();
      results.push(...await pagedResponses(pds, did, rkey, 'service'));
    } catch (err) {
      console.warn('[responseReads] service repo read failed:', err.message);
    }
  }
  return results;
}
```

- [ ] **Step 4: Run → PASS.** Then `node --check server/src/lib/responseReads.js`.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/responseReads.js server/test/responseReads.test.js
git commit -m "feat(reads): merge creator + service repo responses, paged and poll-filtered (#42)"
```

---

## Task 3: Branch the response write routes on the service flag

**Files:**
- Modify: `server/src/routes/responses.js`
- Test: `server/test/responses.test.js`

**Interfaces:**
- Consumes: `isServiceConfigured`, `serviceCreateRecord`, `servicePutRecord`, `serviceDeleteRecord`, `serviceGetRecord` (Task 1). Keeps the existing `findOauthSessionByDid` for the legacy fallback.
- Produces: unchanged HTTP contract (`201 { ok, responseCount, responseRkey }` on POST; `200 { ok }` on PUT/DELETE). The 503 is now reachable ONLY on the legacy path (service not configured, or PUT/DELETE of a legacy record).

- [ ] **Step 1: Update the tests** for the branched behavior. Add a service-configured mock and cases; keep the legacy cases guarded by an unset flag. Extend the existing file:

```js
// Add near the other mocks:
let serviceCalls = [];
let serviceHas = new Set(); // rkeys the service repo "contains" (for getRecord disambiguation)
mock.module('../src/lib/serviceSession.js', {
  namedExports: {
    isServiceConfigured: () => process.env.AVAILS_SERVICE_IDENTIFIER === 'on',
    serviceCreateRecord: async (collection, record) => { serviceCalls.push({ op: 'create', collection, record }); return { uri: 'at://did:plc:svc/chat.avails.scheduling.response/svc123' }; },
    servicePutRecord: async (collection, rkey, record) => { serviceCalls.push({ op: 'put', rkey, record }); },
    serviceDeleteRecord: async (collection, rkey) => { serviceCalls.push({ op: 'delete', rkey }); },
    serviceGetRecord: async (collection, rkey) => (serviceHas.has(rkey) ? { uri: `at://did:plc:svc/c/${rkey}`, value: {} } : null),
  },
});
```

Add cases (in a new `describe('service-configured write path')`, with `beforeEach(() => { process.env.AVAILS_SERVICE_IDENTIFIER = 'on'; serviceCalls = []; serviceHas = new Set(); })` and an `afterEach` clearing the flag):

```js
it('POST writes to the service repo, not the creator session, and never 503s when creator is signed out', async () => {
  mockSessions.clear(); // creator NOT signed in
  const app = createApp();
  const res = await request(app, 'POST', path, { name: 'Bea', slots: ['2026-07-21T09:00'] });
  assert.equal(res.status, 201);
  assert.equal(serviceCalls.length, 1);
  assert.equal(serviceCalls[0].op, 'create');
  assert.equal(serviceCalls[0].record.name, 'Bea');
  assert.equal(serviceCalls[0].record.pollUri.includes(rkey), true);
  assert.equal(res.body.responseRkey, 'svc123');
});

it('PUT of a service-repo record uses the service session', async () => {
  serviceHas.add('resp456');
  const app = createApp();
  const res = await request(app, 'PUT', `/api/polls/${did}/${rkey}/responses/resp456`, { name: 'Bea', slots: ['2026-07-21T09:00'] });
  assert.equal(res.status, 200);
  assert.equal(serviceCalls.at(-1).op, 'put');
});

it('PUT of a legacy (creator-repo) record falls back to the creator session', async () => {
  // serviceHas is empty → getRecord returns null → legacy path
  mockSessions.set('creator-session', { did, oauthSession: { fetchHandler: mockFetchHandler } });
  const app = createApp();
  const res = await request(app, 'PUT', `/api/polls/${did}/${rkey}/responses/legacyRK`, { name: 'Bea', slots: ['2026-07-21T09:00'] });
  assert.equal(res.status, 200);
  assert.equal(serviceCalls.length, 0);      // service NOT used
  assert.ok(lastXrpcCall);                     // creator session WAS used
});
```

The existing legacy `describe` blocks keep asserting the current behavior with the flag unset (their `beforeEach` should `delete process.env.AVAILS_SERVICE_IDENTIFIER`). Keep the "returns 503 when creator session is missing" test — but scope it under the legacy (unset-flag) describe, since 503 is now legacy-only.

- [ ] **Step 2: Run → new cases FAIL** (`cd server && node --test --experimental-test-module-mocks test/responses.test.js`).

- [ ] **Step 3: Implement the branch.** In `responses.js`, import the service module, then in each handler:

```js
import {
  isServiceConfigured, serviceCreateRecord, servicePutRecord, serviceDeleteRecord, serviceGetRecord,
} from '../lib/serviceSession.js';
```

POST handler — replace the creator-session block with:
```js
    const pollUri = `at://${did}/${POLL_COLLECTION}/${rkey}`;
    const record = { $type: RESPONSE_COLLECTION, pollUri, ...req.validatedBody, createdAt: new Date().toISOString() };

    let createdResponseRkey = null;
    if (isServiceConfigured()) {
      const createResult = await serviceCreateRecord(RESPONSE_COLLECTION, record);
      createdResponseRkey = createResult?.uri?.split('/').pop() || null;
    } else {
      const creatorSession = await findOauthSessionByDid(did);
      if (!creatorSession) return res.status(503).json({ error: /* existing message */ });
      const createResult = await xrpcCall(creatorSession, 'com.atproto.repo.createRecord', { repo: did, collection: RESPONSE_COLLECTION, record });
      createdResponseRkey = createResult?.uri?.split('/').pop() || null;
    }
    const newCount = incrementResponseCount(did, rkey);
    // ...notification block unchanged (it reads the poll via unauthenticated getRecord)...
```

PUT handler — disambiguate:
```js
    if (isServiceConfigured() && await serviceGetRecord(RESPONSE_COLLECTION, responseRkey)) {
      await servicePutRecord(RESPONSE_COLLECTION, responseRkey, record);
    } else {
      const creatorSession = await findOauthSessionByDid(did);
      if (!creatorSession) return res.status(503).json({ error: /* existing message */ });
      await xrpcCall(creatorSession, 'com.atproto.repo.putRecord', { repo: did, collection: RESPONSE_COLLECTION, rkey: responseRkey, record });
    }
```

DELETE handler — same disambiguation with `serviceDeleteRecord` vs the existing creator-session delete.

- [ ] **Step 4: Run → PASS** (all cases, both branches). `node --check server/src/routes/responses.js`.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/responses.js server/test/responses.test.js
git commit -m "feat(responses): write to the service repo when configured, legacy fallback otherwise (#42, #72)"
```

---

## Task 4: Wire the read merge into `polls.js`

**Files:**
- Modify: `server/src/routes/polls.js` (three read sites: ~136 GET, ~248 finalize, ~344 unschedule)
- Test: `server/test/polls.responses.test.js` (new)

**Interfaces:**
- Consumes: `fetchPollResponses` (Task 2).

- [ ] **Step 1: Write a failing test** — mount the polls router with `fetchPollResponses` mocked to return one `creator` + one `service` response; assert `GET /:did/:rkey` returns both in `responses`. (Mock `resolvePds`/poll `getRecord` for the poll record itself as the existing tests do; the point is that the response list now comes through the helper.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Add `import { fetchPollResponses } from '../lib/responseReads.js';`. Replace each of the three inline blocks:

GET `/:did/:rkey` (lines ~136-145) →
```js
    const responses = await fetchPollResponses(did, rkey);
    res.json({ poll: poll.value, uri: poll.uri, cid: poll.cid, responses });
```

Finalize (lines ~248-253) → replace the `responsesUrl`/fetch/filter/map with:
```js
    const pollResponses = await fetchPollResponses(did, rkey);
```
(the downstream `participants`/`responseEmails` code consumes `pollResponses` unchanged — the objects still carry `name`/`email`).

Unschedule (lines ~344-349) → same substitution to `pollResponses`.

Delete the now-unused local `RESPONSE_COLLECTION` listRecords URLs if nothing else references them (keep the constant if the poll read still uses it elsewhere — grep first).

- [ ] **Step 4: Run → PASS**, plus the full suite: `cd server && npm test` (every existing polls test stays green — the helper returns the same shape the inline code did, plus `home`/`uri`/`cid`).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/polls.js server/test/polls.responses.test.js
git commit -m "refactor(polls): read responses via the merged creator+service helper (#42)"
```

---

## Task 5: Docs, env, and the deleted hard constraint

**Files:** `docs/architecture.md`, `CLAUDE.md` (both docs-direct-to-main eligible, but commit on the branch here so the PR is self-describing).

- [ ] Add to `docs/architecture.md`: a "Service identity" subsection — the did:plc account, app-password auth, the service repo as the response store, the read-merge, and the `isServiceConfigured()` fallback. Note #77's resolution (did:plc now; did:web deferred).
- [ ] In `CLAUDE.md`, **replace** the hard constraint "Anonymous responses require creator's session. If the creator's session expires or is lost, participants can't submit." with: "Responses write to avails' own service repo (`AVAILS_SERVICE_*`); the creator's session is not on the response path. When the service identity is unconfigured, the legacy creator-session path applies (and can 503 if the creator is signed out)."
- [ ] Add the env vars to the Deployment section: `AVAILS_SERVICE_IDENTIFIER`, `AVAILS_SERVICE_APP_PASSWORD`, optional `AVAILS_SERVICE_PDS`.
- [ ] Commit: `docs(architecture): document the service-repo response store + activation flag (#42, #77)`.

---

## Task 6: Provisioning + real-PDS smoke (HUMAN-GATED — activation, not merge)

**Not a code task. Gates activation, not merge.** The PR can merge and deploy dark (flag off) before any of this.

- [ ] **Provision (Artem):** create a dedicated ATProto account for avails (bsky.social is simplest). Optionally set the handle to `avails.zhgnv.com` via a `_atproto.avails.zhgnv.com` DNS TXT record (independent of the existing A/CNAME for the web app). Generate an app password in account settings.
- [ ] **Set Railway env:** `AVAILS_SERVICE_IDENTIFIER` (handle or DID), `AVAILS_SERVICE_APP_PASSWORD` (the app password). Redeploy.
- [ ] **Smoke (real PDS):** submit a response to a test poll **while signed out as the creator** → expect `201`, no 503. Confirm the response appears on the poll page (read-merge). Confirm the record exists in the service repo (`listRecords` on the service DID) and NOT in the creator's. Edit + delete the response → both succeed via the service session.
- [ ] **Regression:** an existing (legacy) poll's old responses still render (creator-repo leg of the merge), and editing one still works (creator-session fallback).
- [ ] Post results to #42; close #77 (did:plc chosen); verify whether #72 and #117 can close (the triage in #125).

---

## Self-Review

- **Spec coverage (#42 Stage 1):** service identity (#77) → Task 1; write path to service repo → Task 3; read merge → Tasks 2+4; hard-constraint deletion → Task 5; activation/smoke → Task 6. Stage 2 (own-PDS authenticated responses) and private-scope responses are explicitly out of scope per #42.
- **Type consistency:** `fetchPollResponses(creatorDid, rkey) → [{...value, uri, cid, home}]` used identically in Tasks 2 and 4; the service module's `serviceCreateRecord/PutRecord/DeleteRecord/GetRecord` signatures match between Task 1 export and Task 3 import/mock.
- **YAGNI note (deviation from the design's letter):** the design mentioned extending the poll-index with per-poll response rkeys. This plan does **not** — nothing consumes it in Stage 1 (reads page + filter, which is correct at current scale). The index-driven read (getRecord by stored rkeys, with a paged-scan rebuild fallback) is the documented scale follow-up, filed when the service repo growth makes paging expensive. Flagged rather than silently dropped.
- **Reversibility:** flag-gated; unset the env vars to revert to legacy behavior with no redeploy of code.
