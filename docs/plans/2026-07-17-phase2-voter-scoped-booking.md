# Phase 2 (avails slice): Voter-Scoped Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `schedule_call` book for an explicit set of voter DIDs (the people who opted into a specific proposal) instead of only the whole list — the direct implementation of #119's "book for who voted."

**Architecture:** Additive. `schedule_call` today resolves *every* list member's availability via `resolveListAvailability(listUri)`. This adds an optional `voterDids` argument: when present, resolve availability for exactly those DIDs (still filtered to records scoped to the list), then run the identical overlap → coverage → trust → book pipeline. When absent, behaviour is unchanged (whole list). The per-DID resolver `resolveMemberRecord(did, listUri)` already exists; the only new plumbing is a shared `resolveAvailabilityForDids(dids, listUri)` that both the whole-list and voter paths call.

**Tech Stack:** Node ES modules, Node built-in test runner (`node:test` + `--experimental-test-module-mocks`), Luxon (already a dep). No new dependencies.

## Global Constraints

- **Opt-in is the record's scope, not list membership (#110).** `resolveMemberRecord(did, listUri)` counts a DID's record only if `record.value.scope.value === listUri` and it's unexpired. A voter who liked but published no record for this list contributes nothing — that's a coverage miss, correct, not a reason to widen the set. This is why voter-scoping needs no list-membership check: a voter's record scoped to the list IS their opt-in.
- **Coverage floors are unchanged.** `MIN_CALL_COVERAGE = 2`. The three existing floors in `scheduleCall` (withRecords < 2, no overlap, top.count < 2) apply identically to the voter path. This resolves D6 (quorum: a voter without a record can't be placed) and D7 (thin-coverage floor: reuse the constant) at the avails layer with no new decision.
- **Fail loud on a malformed scope, never silent-empty.** A bad list URI must throw, not resolve to "0 records" (which would read as a legitimate thin-coverage fallback). Session lesson: silence and success must not look identical.
- **The test script globs `test/*.test.js` (#108, #111)** — a new test file is gated automatically; do NOT edit `package.json` to register one.
- **avails stays channel-agnostic (#103/#119).** It receives DIDs and never learns whether they came from a Bluesky like, an MC vote, or a Telegram reaction. `voterDids` is named for the epic's concept but the tool interprets nothing about how they voted.
- **Existing `scheduleCall` tests (a)–(h) in `test/scheduleCall.test.js` must stay green** — they call `schedule_call` without `voterDids`, exercising the unchanged whole-list path.

---

## File Structure

- **Modify** `server/src/mcp/listMembers.js` — extract `resolveAvailabilityForDids(dids, listUri)`; `resolveListAvailability` becomes a thin caller of it. Export `parseListUri` so the voter path can validate the scope URI.
- **Modify** `server/src/mcp/tools.js` — `scheduleCall` accepts optional `voterDids`; validate it; branch the resolution; surface voter coverage in the response. Update the `schedule_call` entry in `TOOL_DEFINITIONS`.
- **Modify** `server/test/listMembers.test.js` — add tests for `resolveAvailabilityForDids` (and confirm the existing `resolveListAvailability` suite still passes).
- **Modify** `server/test/scheduleCall.test.js` — extend the `mock.module('../src/mcp/listMembers.js', …)` block to also export `resolveAvailabilityForDids`; add voter-scoped cases.

---

## Task 1: Extract `resolveAvailabilityForDids` (behaviour-preserving refactor)

**Files:**
- Modify: `server/src/mcp/listMembers.js` (the `resolveListAvailability` function, ~lines 115-134, plus `parseListUri` at ~line 41)
- Test: `server/test/listMembers.test.js`

**Interfaces:**
- Produces: `export async function resolveAvailabilityForDids(dids: string[], listUri: string): Promise<Array<{did, record}>>` — resolves each DID's latest unexpired availability record scoped to `listUri`; per-DID failures are skipped (non-fatal); input DIDs are deduped; throws if `listUri` is not a well-formed `at://<did>/app.bsky.graph.list/<rkey>` URI.
- Produces: `export function parseListUri(listUri): string` (was already defined, now exported) — returns the authority DID, throws on malformed input.
- Consumes: existing `resolveMemberRecord(did, listUri)`, `fetchListMemberDids(listUri)`.

- [ ] **Step 1: Write the failing test for `resolveAvailabilityForDids`**

Add to `server/test/listMembers.test.js` (it already has `fetchImpl`, `pdsDoc`, `availabilityRecord`, `LIST_URI` helpers — reuse them; import the new symbol at the top alongside `resolveListAvailability`):

```js
// at top, extend the import:
const { resolveListAvailability, resolveAvailabilityForDids, parseListUri } =
  await import('../src/mcp/listMembers.js');

describe('resolveAvailabilityForDids', () => {
  it('resolves only the given DIDs, filtered to records scoped to the list', async () => {
    fetchImpl = async (url) => {
      const u = String(url);
      if (u.startsWith('https://plc.directory/')) {
        const did = decodeURIComponent(u.replace('https://plc.directory/', ''));
        return { ok: true, json: async () => pdsDoc(`https://pds.${did.split(':').pop()}.example`) };
      }
      if (u.includes('com.atproto.repo.listRecords')) {
        const repo = new URL(u).searchParams.get('repo');
        if (repo === 'did:plc:alice') {
          return { ok: true, json: async () => ({ records: [availabilityRecord('did:plc:alice', {
            validUntil: new Date(Date.now() + 86400000).toISOString(),
          })] }) };
        }
        return { ok: true, json: async () => ({ records: [] }) }; // bob: no record
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };

    const result = await resolveAvailabilityForDids(['did:plc:alice', 'did:plc:bob'], LIST_URI);
    assert.equal(result.length, 1);
    assert.equal(result[0].did, 'did:plc:alice');
    // getList is NEVER called — this path takes an explicit DID set.
  });

  it('dedupes repeated DIDs and never calls getList', async () => {
    let getListCalled = false;
    fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('app.bsky.graph.getList')) { getListCalled = true; return { ok: true, json: async () => ({ items: [] }) }; }
      if (u.startsWith('https://plc.directory/')) return { ok: true, json: async () => pdsDoc('https://pds.alice.example') };
      if (u.includes('com.atproto.repo.listRecords')) {
        return { ok: true, json: async () => ({ records: [availabilityRecord('did:plc:alice', {
          validUntil: new Date(Date.now() + 86400000).toISOString() })] }) };
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };
    const result = await resolveAvailabilityForDids(['did:plc:alice', 'did:plc:alice'], LIST_URI);
    assert.equal(result.length, 1);
    assert.equal(getListCalled, false, 'voter path must not enumerate the list');
  });

  it('throws on a malformed list URI rather than silently resolving nothing', async () => {
    fetchImpl = async () => { throw new Error('should not fetch for a malformed URI'); };
    await assert.rejects(
      () => resolveAvailabilityForDids(['did:plc:alice'], 'not-a-list-uri'),
      /Invalid list URI|Not an app\.bsky\.graph\.list/
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && node --test test/listMembers.test.js`
Expected: FAIL — `resolveAvailabilityForDids is not a function` (not yet exported).

- [ ] **Step 3: Extract the function and export `parseListUri`**

In `server/src/mcp/listMembers.js`, change `function parseListUri` to `export function parseListUri`. Then replace the body of `resolveListAvailability` and add the new export:

```js
// Resolves the standing-availability records a given set of DIDs have published
// for a specific list scope. Per-DID failures (PDS resolution / listRecords) are
// non-fatal — that DID is skipped, not the whole call. DIDs are deduped. The
// list URI is validated up front so a malformed scope throws loudly rather than
// resolving to an empty set (which would masquerade as thin coverage).
//
// Shared by resolveListAvailability (the whole list) and schedule_call's
// voter-scoped path (an explicit subset who opted into a proposal) — #103/#119.
export async function resolveAvailabilityForDids(dids, listUri) {
  parseListUri(listUri); // throws on a malformed at:// list URI
  const unique = [...new Set(dids)];

  const outcomes = await Promise.allSettled(
    unique.map((did) => resolveMemberRecord(did, listUri))
  );

  const results = [];
  outcomes.forEach((outcome, i) => {
    const did = unique[i];
    if (outcome.status === 'fulfilled') {
      if (outcome.value) results.push({ did, record: outcome.value });
    } else {
      console.error(`[listMembers] Skipping ${did} (availability lookup failed):`, outcome.reason?.message || outcome.reason);
    }
  });
  return results;
}

// Resolves a Bluesky list to the standing-availability records its members have
// published for that list. Includes the list OWNER, whom getList omits (#110).
export async function resolveListAvailability(listUri) {
  const ownerDid = parseListUri(listUri);
  const dids = [ownerDid, ...(await fetchListMemberDids(listUri))];
  return resolveAvailabilityForDids(dids, listUri);
}
```

- [ ] **Step 4: Run all listMembers tests**

Run: `cd server && node --test test/listMembers.test.js`
Expected: PASS — the new `resolveAvailabilityForDids` suite AND every existing `resolveListAvailability` test (a)–(j), since the refactor is behaviour-preserving (the owner is still unioned in, dedupe still happens inside the shared function).

- [ ] **Step 5: Commit**

```bash
git add server/src/mcp/listMembers.js server/test/listMembers.test.js
git commit -m "refactor(mcp): extract resolveAvailabilityForDids from resolveListAvailability (#103)"
```

---

## Task 2: Add `voterDids` to `schedule_call`

**Files:**
- Modify: `server/src/mcp/tools.js` — `scheduleCall` (~line 896) and the `schedule_call` entry in `TOOL_DEFINITIONS` (~line 328)
- Test: `server/test/scheduleCall.test.js`

**Interfaces:**
- Consumes: `resolveAvailabilityForDids` from Task 1 (import it alongside the existing `resolveListAvailability` import at `tools.js:8`).
- Produces: `schedule_call({ scope, durationMinutes, window, title, voterDids? })`. When `voterDids` is a non-empty array of DID strings, book for exactly those DIDs (records still scoped to `scope`). When absent, unchanged. `voterDids: []` or a non-array (when present) throws.

- [ ] **Step 1: Write the failing tests**

In `server/test/scheduleCall.test.js`, first extend the listMembers mock so the voter path is mockable:

```js
// existing block gains one export:
mock.module('../src/mcp/listMembers.js', {
  namedExports: {
    resolveListAvailability: (...a) => resolveListAvailabilityImpl(...a),
    resolveAvailabilityForDids: (...a) => resolveAvailabilityForDidsImpl(...a),
  },
});
// add a hook alongside resolveListAvailabilityImpl:
let resolveAvailabilityForDidsImpl;
// in resetHooks(): default it to a throw, like resolveListAvailability
resolveAvailabilityForDidsImpl = async () => { throw new Error('resolveAvailabilityForDids should not be called in this test'); };
```

Then add cases:

```js
it('(i) voterDids present -> books for exactly those DIDs via resolveAvailabilityForDids, not the whole list', async () => {
  resetHooks();
  let listCalled = false;
  resolveListAvailabilityImpl = async () => { listCalled = true; return []; };
  resolveAvailabilityForDidsImpl = async (dids, listUri) => {
    assert.equal(listUri, LIST_URI);
    assert.deepEqual([...dids].sort(), ['did:plc:alice', 'did:plc:bob']);
    return [member('did:plc:alice', 'auto'), member('did:plc:bob', 'auto')];
  };
  bestCallSlotsImpl = () => [
    { slot: '2026-07-21T14:00', participants: ['did:plc:alice', 'did:plc:bob'], count: 2 },
  ];

  const result = JSON.parse(await callTool('schedule_call', {
    scope: { type: 'atproto-list', value: LIST_URI },
    durationMinutes: 60, window: WINDOW, title: 'Voted call',
    voterDids: ['did:plc:alice', 'did:plc:bob'],
  }, null));

  assert.equal(result.booked, true);
  assert.equal(listCalled, false, 'whole-list resolution must NOT run when voterDids is given');
  assert.equal(result.coverage.withRecords, 2);
});

it('(j) a voter with no record is a coverage miss -> falls back, does not widen the set', async () => {
  resetHooks();
  // only 1 of the 2 voters has a record -> withRecords 1 < MIN_CALL_COVERAGE
  resolveAvailabilityForDidsImpl = async () => [member('did:plc:alice', 'auto')];
  const result = JSON.parse(await callTool('schedule_call', {
    scope: { type: 'atproto-list', value: LIST_URI },
    durationMinutes: 60, window: WINDOW, title: 'Voted call',
    voterDids: ['did:plc:alice', 'did:plc:ghost'],
  }, null));
  assert.equal(result.booked, false);
  assert.equal(result.fallback, 'create_poll');
});

it('(k) voterDids present but empty is a caller error, not a silent poll fallback', async () => {
  resetHooks();
  await assert.rejects(
    () => callTool('schedule_call', {
      scope: { type: 'atproto-list', value: LIST_URI },
      durationMinutes: 60, window: WINDOW, title: 'x', voterDids: [],
    }, null),
    /voterDids.*non-empty|non-empty.*voterDids/i
  );
});

it('(l) a non-array voterDids is rejected', async () => {
  resetHooks();
  await assert.rejects(
    () => callTool('schedule_call', {
      scope: { type: 'atproto-list', value: LIST_URI },
      durationMinutes: 60, window: WINDOW, title: 'x', voterDids: 'did:plc:alice',
    }, null),
    /voterDids must be an array/i
  );
});
```

(The existing (a)–(e) cases, which pass no `voterDids`, are the regression guard that the whole-list path is untouched.)

- [ ] **Step 2: Run to verify the new cases fail**

Run: `cd server && node --experimental-test-module-mocks --test test/scheduleCall.test.js`
Expected: (i)–(l) FAIL (voterDids ignored / not validated); (a)–(h) PASS.

- [ ] **Step 3: Implement — import, validate, branch**

In `tools.js`, extend the import at line 8:
```js
import { resolveListAvailability, resolveAvailabilityForDids } from './listMembers.js';
```

In `scheduleCall`, after the existing `title` check and before `const members = await resolveListAvailability(...)`, add validation and branch the resolution:

```js
  // Optional voter-scoped booking (#103/#119): when the caller supplies an
  // explicit set of DIDs (the people who opted into a proposal), book for that
  // subset instead of the whole list. avails does not interpret HOW they voted
  // (a Bluesky like, an MC vote, a Telegram reaction) — it receives DIDs. Their
  // records are still matched to `scope`, so a voter who published nothing for
  // this list is a coverage miss, exactly as an absent list member would be.
  if (voterDids !== undefined) {
    if (!Array.isArray(voterDids)) throw new Error('voterDids must be an array of DID strings');
    if (voterDids.length === 0) throw new Error('voterDids, when provided, must be non-empty');
    if (!voterDids.every((d) => typeof d === 'string' && d.startsWith('did:'))) {
      throw new Error('voterDids must be an array of DID strings');
    }
  }

  const members = voterDids
    ? await resolveAvailabilityForDids(voterDids, normalizedScope.value)
    : await resolveListAvailability(normalizedScope.value);
```

Update the function signature to destructure the new arg:
```js
async function scheduleCall({ scope, durationMinutes, window, title, voterDids }) {
```

Everything after `const members = …` (coverage floors, `bestCallSlots`, trust split, ICS, return) is unchanged. Optionally enrich the response so the caller sees voter coverage — add to the booked-return `coverage` object:
```js
    coverage: {
      withRecords,
      membersFree: top.count,
      ...(voterDids ? { voters: voterDids.length, votersWithoutRecords: voterDids.length - withRecords } : {}),
    },
```

- [ ] **Step 4: Update the `schedule_call` tool schema**

In `TOOL_DEFINITIONS`, add `voterDids` to `schedule_call`'s `inputSchema.properties` (do NOT add it to `required`):
```js
        voterDids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. When present, book only for these DIDs (the people who opted into this specific proposal — e.g. the likers of a Bluesky post), instead of the whole list. Their records are still matched to `scope`; a DID that published no availability for this list is a coverage miss. Omit to schedule for the entire list.',
        },
```
Extend the tool's top-level `description` with one sentence: `Pass voterDids to book for a specific subset (who voted/liked) rather than the whole list.`

- [ ] **Step 5: Run the full suite**

Run: `cd server && npm test`
Expected: PASS, count = previous total + 4. `node --check server/src/mcp/tools.js` clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/mcp/tools.js server/test/scheduleCall.test.js
git commit -m "feat(mcp): schedule_call books for an explicit voterDids set (#103)"
```

---

## Out of scope for this slice (tracked, not built here)

- **How CA reaches this** — whether via MCP `schedule_call` or a thin REST route is Phase 2's integration step (the CA proposal-post + `getLikes` tally, Option A, #119). This slice delivers the avails *capability*; a REST wrapper, if CA needs one, just forwards to the same function.
- **The Bluesky like → DID tally** lives in community-admin (#54 / Option A), not avails.
- **Telegram as a voter source** waits on #122 (are reactions attributable?) and #33 (Telegram id → DID).

## Self-Review checklist (run before execution)

- Spec coverage: voter-scoping (#119) ✓, coverage floors reused for D6/D7 ✓, channel-agnostic ✓, malformed-scope fails loud ✓.
- Type consistency: `resolveAvailabilityForDids(dids, listUri)` signature identical in Task 1 export, Task 2 import, and both test mocks ✓.
- No placeholders: every step has runnable code and an exact command ✓.
