# Standing Availability — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the standing-availability core claim — a participant publishes, once, when they're generally free for a group's calls (no poll), and an agent books a call from everyone's records via a `schedule_call` MCP tool. Bluesky-list scope only.

**Architecture:** A new ATProto lexicon `chat.avails.scheduling.availability` stored in the **participant's own PDS**. A REST surface + client UI to set it. A `schedule_call` MCP tool that resolves a Bluesky-list URI → member DIDs → their availability records, expands each record's weekly pattern into candidate slots, reuses the existing overlap solver to pick the best time, and books (ICS/email best-effort, optional OpenMeet). No CA, no Telegram, no My Community anywhere in Phase 1.

**Tech Stack:** Express 4 (ES modules, `server/`), React 19 + Vite 7 + Tailwind v4 + shadcn/ui (`client/`), ATProto XRPC over raw `fetch`, Luxon for timezone math, Node built-in test runner (`node:test`).

**Source of truth:** Citizen-Infra/avails#102 (record + UI) and #103 (schedule_call). This plan is Phase 1 of tasks #2–#6 in the session epic; GATE 1 (#3, lexicon freeze) is folded into Task 1's callout below and reviewed at plan approval.

## Global Constraints

- **No database.** ATProto PDS is the only store. The availability record lives in the **participant's own PDS** (`repo = authContext.did`), a deliberate break from `chat.avails.scheduling.response` (creator-hosted). Never add a DB in Phase 1 (list scope is entirely public-PDS; the private-community DB path is Phase 3+).
- **Every write endpoint MUST have validation middleware.** Routes read `req.validatedBody`, never `req.body`. A missing validator caused silent data corruption (2026-04-07).
- **Session restore must happen after `app.listen()`** — do not touch startup ordering.
- **Lexicon codegen after editing `lexicons/*.json`:** `npx @atproto/lex build --lexicons ./lexicons --out ./server/src/lexicons --indexFile --override`. Generated TS is type-reference only; the server uses raw XRPC `fetch`.
- **New OAuth scope requires a `client_id` version bump + clear-sessions.** ATProto does not re-prompt for upgraded scopes on an existing grant (#49). Adding `repo:chat.avails.scheduling.availability` means bumping the client-metadata URL version and running `POST /api/admin/clear-sessions?key=SESSION_SECRET`.
- **Dates/times use local, not UTC.** Never `toISOString().slice(0,10)`. Use `formatDateLocal()` / explicit `getFullYear()`. Slot keys are `YYYY-MM-DDThh:mm` in a stated timezone; Luxon converts per-slot (DST-safe).
- **UI work goes through the `impeccable` skill + shadcn MCP.** avails has PRODUCT.md + DESIGN.md (North Star "Village Notice Board", Paper Cream `#faf9f6`, single Gather Teal `#0d9488` accent, Geist, flat-with-one-hero). Never hand-roll component CSS; query shadcn MCP first. WCAG 2.1 AA.
- **Grid duplication rule.** `AvailGrid` and `SchedulingGrid` intentionally duplicate; a change to one usually belongs in both. Never pass inline `new Set()`/`{}` as React prop defaults (render loops); never place hooks after early returns (#310).
- **Tests:** server uses `node:test` + `node:assert` (`cd server && npm test`); integration tests mock the PDS/session layer and need `--experimental-test-module-mocks`. Client has no test runner — `cd client && npm run build` is the only client gate. Server syntax check: `node --check server/src/index.js`.
- **Real-LLM/real-PDS smoke before declaring done** — the "no poll" claim is only proven by an actual MCP call end-to-end (Task 10), not unit tests.

---

## GATE 1 — freeze these before the first real user record

These are lexicon-shaped; they get expensive to change once records exist in the wild. **Locked at plan approval, implemented in Task 1.** Recommended values (rationale in #102/#103):

| Knob | Recommendation | Why |
|------|----------------|-----|
| **NSID** | Mint `chat.avails.scheduling.availability` now | No `community.lexicon.*` availability lexicon exists (only events/RSVPs). Our namespace ships fastest and we control the freeze. Records stay user-owned + any-tool-readable regardless of namespace. A neutral `community.lexicon.*` availability lexicon is a **later, parallel** proposal to the Lexicon Community WG — not a Phase-1 blocker. |
| **`scope` shape (D1)** | Object `{ type: 'atproto-list' \| 'ca-community', value: string }` | Explicit + future-proof for the Phase-3 CA path with zero re-freeze; avoids fragile URI-scheme string-parsing. Phase 1 only ever writes `type: 'atproto-list'`, `value: at://…/app.bsky.graph.list/…`. |
| **Visibility (D2)** | List scope → published to the participant's PDS, **public** (on the firehose, permanent, un-retractable). | A Bluesky list is already a public group primitive, so incremental affiliation-exposure is low. The private-community → avails-DB path does **not** exist in Phase 1 (no private scope is offered). Paired with a short default `validUntil` so the longitudinal pattern decays. |
| **`trust` default (D3)** | `confirm` (enum `confirm \| auto`) | Safe default: no agent auto-books without an explicit opt-in to `auto`. The grant lives in the user's own record and is revocable there. |
| **`validUntil` default** | 8 weeks from publish, user-adjustable | "Short by default" (#102) so a stale pattern-of-life decays rather than lingering on the firehose. |

The lexicon schema includes **both** `pattern.weekly` and `pattern.dateRanges` (both named in #102) so the frozen shape needn't change; Phase-1 UI + solver implement `weekly`, and `dateRanges` is reserved (accepted + stored, not yet surfaced).

---

## File Structure

**Create:**
- `lexicons/chat/avails/scheduling/availability.json` — the frozen lexicon.
- `server/src/lib/availabilityValidate.js` — record-shape validator (mirrors `middleware/validate.js`).
- `server/src/routes/availability.js` — `/api/availability` CRUD against the caller's own PDS.
- `server/src/mcp/listMembers.js` — resolve a Bluesky-list URI → member DIDs → their availability records.
- `server/src/mcp/availabilityOverlap.js` — expand `pattern.weekly` → candidate slots within a window, honour `trust`, feed `computeBestSlots`.
- `client/src/pages/StandingAvailability.jsx` — the set-your-availability page (impeccable-shaped).
- `client/src/components/WeeklyPatternGrid.jsx` — recurring weekly-window painter (impeccable-shaped).
- `server/test/availabilityValidate.test.js`, `server/test/availability.route.test.js`, `server/test/availabilityOverlap.test.js`, `server/test/listMembers.test.js`.

**Modify:**
- `server/src/mcp/tools.js` — add `schedule_call` to `TOOL_DEFINITIONS` + `callTool`.
- `server/src/index.js` — mount the `/api/availability` router.
- `server/src/middleware/validate.js` — export the availability validator (or wire the new module).
- The client-metadata scopes config (wherever `repo:chat.avails.scheduling.poll` is declared) — add `repo:chat.avails.scheduling.availability` + bump `client_id` version.
- `client/src/App.jsx` (router) — add the `/availability` route + a nav entry.

---

## Deliverable A — #102: the record and the UI

### Task 1: Mint and freeze the availability lexicon  ⟵ GATE 1 ARTIFACT

**Files:**
- Create: `lexicons/chat/avails/scheduling/availability.json`
- Regenerate: `server/src/lexicons/` (codegen output, type-reference only)

**Interfaces:**
- Produces: the record shape every later task depends on — `$type: 'chat.avails.scheduling.availability'`, `scope: {type, value}`, `pattern: {weekly:[{day,startTime,endTime}], dateRanges?:[…]}`, `timezone`, `trust`, `validUntil`, `createdAt`, `updatedAt`.

- [ ] **Step 1: Write the lexicon**

```json
{
  "lexicon": 1,
  "id": "chat.avails.scheduling.availability",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "description": "A participant's standing availability for a specific group's calls. Self-hosted in the participant's own PDS.",
      "record": {
        "type": "object",
        "required": ["scope", "pattern", "timezone", "trust", "createdAt"],
        "properties": {
          "scope": {
            "type": "ref",
            "ref": "#scope",
            "description": "The single group this offer is for."
          },
          "pattern": { "type": "ref", "ref": "#pattern" },
          "timezone": {
            "type": "string",
            "description": "IANA timezone, e.g. America/New_York. Windows are interpreted in this zone."
          },
          "trust": {
            "type": "string",
            "knownValues": ["confirm", "auto"],
            "description": "confirm = ask me before booking; auto = an agent may book into my windows without confirming each time."
          },
          "validUntil": {
            "type": "string",
            "format": "datetime",
            "description": "Expiry. Short by default so the pattern decays."
          },
          "createdAt": { "type": "string", "format": "datetime" },
          "updatedAt": { "type": "string", "format": "datetime" }
        }
      }
    },
    "scope": {
      "type": "object",
      "required": ["type", "value"],
      "properties": {
        "type": { "type": "string", "knownValues": ["atproto-list", "ca-community"] },
        "value": {
          "type": "string",
          "description": "For atproto-list: an at:// URI of an app.bsky.graph.list. For ca-community (Phase 3): the community-admin community id."
        }
      }
    },
    "pattern": {
      "type": "object",
      "required": ["weekly"],
      "properties": {
        "weekly": {
          "type": "array",
          "description": "Recurring weekly windows.",
          "items": { "type": "ref", "ref": "#window" }
        },
        "dateRanges": {
          "type": "array",
          "description": "Reserved for explicit one-off date ranges (Phase 1.1). Stored, not yet surfaced.",
          "items": { "type": "ref", "ref": "#dateRange" }
        }
      }
    },
    "window": {
      "type": "object",
      "required": ["day", "startTime", "endTime"],
      "properties": {
        "day": { "type": "integer", "minimum": 0, "maximum": 6, "description": "0=Sunday … 6=Saturday (JS getDay convention)." },
        "startTime": { "type": "string", "description": "HH:MM 24h, in the record's timezone." },
        "endTime": { "type": "string", "description": "HH:MM 24h, in the record's timezone." }
      }
    },
    "dateRange": {
      "type": "object",
      "required": ["start", "end"],
      "properties": {
        "start": { "type": "string", "description": "YYYY-MM-DD" },
        "end": { "type": "string", "description": "YYYY-MM-DD" },
        "startTime": { "type": "string" },
        "endTime": { "type": "string" }
      }
    }
  }
}
```

- [ ] **Step 2: Run codegen**

Run: `npx @atproto/lex build --lexicons ./lexicons --out ./server/src/lexicons --indexFile --override`
Expected: new generated file(s) under `server/src/lexicons/` for the availability type, no errors.

- [ ] **Step 3: Syntax check + commit**

Run: `node --check server/src/index.js`
Expected: no output (pass).

```bash
git add lexicons/chat/avails/scheduling/availability.json server/src/lexicons/
git commit -m "feat(lexicon): mint chat.avails.scheduling.availability (GATE 1 freeze)"
```

### Task 2: Availability record validator

**Files:**
- Create: `server/src/lib/availabilityValidate.js`
- Test: `server/test/availabilityValidate.test.js`

**Interfaces:**
- Produces: `validateAvailability(body) -> { valid: true, value } | { valid: false, error }`. Whitelists fields, enforces types/ranges. Consumed by the route (Task 3).

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { validateAvailability } from '../src/lib/availabilityValidate.js';

test('accepts a minimal valid record', () => {
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: 'at://did:plc:x/app.bsky.graph.list/abc' },
    pattern: { weekly: [{ day: 2, startTime: '14:00', endTime: '18:00' }] },
    timezone: 'Europe/Berlin',
    trust: 'confirm',
  });
  assert.equal(r.valid, true);
  assert.equal(r.value.trust, 'confirm');
});

test('rejects a bad day index', () => {
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: 'at://x/app.bsky.graph.list/abc' },
    pattern: { weekly: [{ day: 9, startTime: '14:00', endTime: '18:00' }] },
    timezone: 'Europe/Berlin', trust: 'confirm',
  });
  assert.equal(r.valid, false);
});

test('rejects unknown trust value and strips unknown fields', () => {
  const bad = validateAvailability({ scope:{type:'atproto-list',value:'at://x/app.bsky.graph.list/a'}, pattern:{weekly:[{day:1,startTime:'09:00',endTime:'12:00'}]}, timezone:'UTC', trust:'always' });
  assert.equal(bad.valid, false);
  const ok = validateAvailability({ scope:{type:'atproto-list',value:'at://x/app.bsky.graph.list/a'}, pattern:{weekly:[{day:1,startTime:'09:00',endTime:'12:00'}]}, timezone:'UTC', trust:'auto', injected:'evil' });
  assert.equal(ok.valid, true);
  assert.equal(ok.value.injected, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/availabilityValidate.test.js`
Expected: FAIL ("validateAvailability is not a function" / cannot find module).

- [ ] **Step 3: Implement the validator**

```js
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const SCOPE_TYPES = new Set(['atproto-list', 'ca-community']);
const TRUST = new Set(['confirm', 'auto']);

function validWindow(w) {
  return w && Number.isInteger(w.day) && w.day >= 0 && w.day <= 6 &&
    HHMM.test(w.startTime || '') && HHMM.test(w.endTime || '') && w.startTime < w.endTime;
}

export function validateAvailability(body) {
  try {
    const { scope, pattern, timezone, trust, validUntil } = body || {};
    if (!scope || !SCOPE_TYPES.has(scope.type) || typeof scope.value !== 'string' || !scope.value) {
      return { valid: false, error: 'scope must be { type, value }' };
    }
    // Phase 1 only publishes atproto-list scope.
    if (scope.type !== 'atproto-list') return { valid: false, error: 'Phase 1 supports atproto-list scope only' };
    if (!pattern || !Array.isArray(pattern.weekly) || pattern.weekly.length === 0) {
      return { valid: false, error: 'pattern.weekly must be a non-empty array' };
    }
    if (!pattern.weekly.every(validWindow)) return { valid: false, error: 'invalid weekly window' };
    if (typeof timezone !== 'string' || !timezone) return { valid: false, error: 'timezone required' };
    if (!TRUST.has(trust)) return { valid: false, error: 'trust must be confirm|auto' };
    const now = new Date().toISOString();
    const value = {
      scope: { type: scope.type, value: scope.value },
      pattern: { weekly: pattern.weekly.map((w) => ({ day: w.day, startTime: w.startTime, endTime: w.endTime })) },
      timezone,
      trust,
      validUntil: validUntil || new Date(Date.now() + 56 * 24 * 3600 * 1000).toISOString(),
    };
    return { valid: true, value };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test test/availabilityValidate.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/availabilityValidate.js server/test/availabilityValidate.test.js
git commit -m "feat(availability): record validator with field whitelist + range checks"
```

### Task 3: `/api/availability` CRUD against the caller's own PDS

**Files:**
- Create: `server/src/routes/availability.js`
- Modify: `server/src/index.js` (mount router, after existing route mounts, before error middleware)
- Test: `server/test/availability.route.test.js`

**Interfaces:**
- Consumes: `validateAvailability` (Task 2); the app-session middleware that populates `req.session.did` + `req.session.oauthSession` (same one `routes/polls.js` uses — mirror its import); `resolvePds`/`xrpcCall` patterns (copy from `tools.js`, or extract to `lib/pds.js` if a shared home is cleaner).
- Produces: `POST /api/availability` (create-or-replace the caller's record for a scope), `GET /api/availability/mine`, `DELETE /api/availability/:rkey`. Writes to `repo = req.session.did`, `collection = 'chat.avails.scheduling.availability'`.

- [ ] **Step 1: Write the failing integration test** (mock the PDS/session layer exactly as `test/responses.test.js` does — inject a fake `oauthSession.fetchHandler` that records the `createRecord` body).

```js
import { test } from 'node:test';
import assert from 'node:assert';
// Follow test/responses.test.js: build an express app with a stubbed session
// middleware that sets req.session = { did, oauthSession: { fetchHandler } }.
// Assert POST /api/availability writes collection
// 'chat.avails.scheduling.availability' to repo=did with trust defaulted.
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && node --test --experimental-test-module-mocks test/availability.route.test.js`
Expected: FAIL (route not mounted → 404).

- [ ] **Step 3: Implement the router** (validation middleware → own-PDS write via `createRecord`; a create replaces any existing record for the same `scope.value` — enforce one-record-per-scope by listing the caller's records and `putRecord`/`deleteRecord` the prior one before creating). Rate-limit create at 30/hr (reuse the poll-creation limiter pattern from `index.js`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && node --test --experimental-test-module-mocks test/availability.route.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/availability.js server/src/index.js server/test/availability.route.test.js
git commit -m "feat(availability): /api/availability CRUD writing to caller's own PDS"
```

### Task 4: OAuth scope + client_id version bump

**Files:**
- Modify: the client-metadata scopes declaration (grep for `repo:chat.avails.scheduling.poll` — likely in `mcp/oauth.js` / an auth config / the served `client-metadata.json`) and the `ATPROTO_CLIENT_ID` version segment.

**Interfaces:**
- Produces: the `repo:chat.avails.scheduling.availability` grant, without which own-PDS writes 403.

- [ ] **Step 1:** Add `repo:chat.avails.scheduling.availability` to the granular scope list wherever the poll/response scopes are declared.
- [ ] **Step 2:** Bump the client-metadata URL version (the `client_id` path segment) — ATProto won't re-prompt an existing grant for the new scope (#49). Document the post-deploy step: `POST /api/admin/clear-sessions?key=SESSION_SECRET`, then users re-consent on next sign-in.
- [ ] **Step 3:** `node --check server/src/index.js`; commit.

```bash
git commit -am "feat(auth): request repo scope for the availability collection (client_id vN+1)"
```

### Task 5: Client — set standing availability (impeccable-shaped)

**Files:**
- Create: `client/src/pages/StandingAvailability.jsx`, `client/src/components/WeeklyPatternGrid.jsx`
- Modify: router + a nav entry.

**This task is shaped live via the `impeccable` skill, not pre-written pixel-code** — it's a visible surface on a PRODUCT.md/DESIGN.md project. At execution time: invoke `impeccable` (craft/shape), query the shadcn MCP before any component, and honour the grid-duplication + stable-prop-reference constraints. The functional contract the plan fixes:

- [ ] Scope picker: paste/enter a Bluesky list URL or `at://` URI (Phase 1 = `atproto-list` only). Validate it resolves via `app.bsky.graph.getList` before enabling publish.
- [ ] `WeeklyPatternGrid`: paint recurring weekly windows (Mon–Sun × time-of-day). Reuse `SchedulingGrid`'s single-column drag + roving-tabIndex keyboard model; do **not** graft onto `AvailGrid`. Emits `pattern.weekly = [{day,startTime,endTime}]`.
- [ ] Controls: timezone (default the browser's), `trust` toggle (default `confirm`, with a one-line plain-language gloss of what `auto` grants), `validUntil` (default 8 weeks).
- [ ] Publish → `POST /api/availability`; show the published record + an honest note that a public-list record is published to your PDS and is public. Editable in place; delete available.
- [ ] Client gate: `cd client && npm run build` passes.
- [ ] Commit.

---

## Deliverable B — #103: `schedule_call`

### Task 6: Resolve a Bluesky list → members → availability records

**Files:**
- Create: `server/src/mcp/listMembers.js`
- Test: `server/test/listMembers.test.js`

**Interfaces:**
- Produces: `async resolveListAvailability(listUri) -> [{ did, record }]` — parse the `at://` list URI, page `app.bsky.graph.getList` for member DIDs, then for each DID `resolvePds` + `listRecords` the availability collection, returning the latest valid, unexpired record per member (skip members with none).

- [ ] **Step 1: Write the failing test** (mock `fetch`: getList returns 2 members; one has a record, one doesn't → result length 1, carries `did` + `record`).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — reuse the `resolvePds` + `listRecords` idioms from `tools.js`; filter `validUntil > now`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.**

### Task 7: Expand patterns → overlap

**Files:**
- Create: `server/src/mcp/availabilityOverlap.js`
- Test: `server/test/availabilityOverlap.test.js`

**Interfaces:**
- Consumes: `computeBestSlots` from `overlap.js` (unchanged), `[{did, record}]` from Task 6.
- Produces: `bestCallSlots({ members, window: {start, end}, durationMinutes }) -> [{ slot, participants, count }]` — for each member, expand `pattern.weekly` across the `window` (dates in the member's `timezone`, converted to a common grid via Luxon), emit `durationMinutes`-aligned candidate slot keys, tag with the member's DID, then hand the flattened `[{name: did, slots}]` list to `computeBestSlots`. Honour `trust`: this function returns overlap for **all** members; the caller (Task 8) separates `auto`-granting members (bookable now) from `confirm` members (must be asked).

- [ ] **Step 1: Write the failing test** — two members, overlapping Tue 14:00–16:00 window, 60-min duration → top slot has count 2. A member in a different tz overlaps correctly after conversion.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the expander (Luxon `DateTime.fromObject` with the member's zone per the architecture-doc pattern) + delegate ranking to `computeBestSlots`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.**

### Task 8: `schedule_call` MCP tool

**Files:**
- Modify: `server/src/mcp/tools.js` (add to `TOOL_DEFINITIONS` + `callTool`)
- Test: `server/test/scheduleCall.test.js`

**Interfaces:**
- Consumes: `resolveListAvailability` (Task 6), `bestCallSlots` (Task 7), `generateIcs`/`sendEmail` (existing), optionally `publishToOpenmeet`/`sharePoll` paths.
- Produces: MCP tool `schedule_call({ scope, durationMinutes, window, title })` → `{ booked, slot, participants, coverage, fallback? }`.

Behaviour (from #103):
- Resolve `scope` (Phase 1: `{type:'atproto-list', value}`) → `resolveListAvailability`.
- `bestCallSlots` over the requested `window`/`duration`.
- **Trust:** book into the top slot; participants with `trust:auto` are auto-included; `trust:confirm` participants are returned in a `needsConfirm` list, not silently booked.
- **Fallback:** if no overlap, or coverage below the floor (default: fewer than 2 members with records, or top-slot count < 2), return `{ booked: false, fallback: 'create_poll', reason }` — do **not** book. (Phase 1 stops here; auto-creating the fallback poll can reuse `createPoll` in a follow-up.)
- On book: `generateIcs` + best-effort `sendEmail` to any member records that carry an email (most won't — email is optional). Return the slot + who was counted. OpenMeet publish is optional and gated on the caller having the scope.
- No poll record is created anywhere in the success path.

- [ ] **Step 1: Write the failing test** (mock Tasks 6/7 + email: 3 members, all `auto`, clear overlap → `booked:true`, correct slot, 3 participants; then a thin-coverage case → `booked:false, fallback:'create_poll'`).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the tool def + impl + `callTool` case.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.**

---

## Cross-cutting

### Task 9: Docs

- [ ] Update `docs/architecture.md` MCP table (add `schedule_call`) + a "Standing availability" subsection (record shape, list-scope discovery, trust). Add the new scope + `client_id` bump to the env/OAuth notes. Update the CLAUDE.md MCP tool count. Docs-only → commit direct.

### Task 10: End-to-end smoke — prove "no poll"

- [ ] Publish standing-availability records for ~3 test DIDs scoped to a real Bluesky list (via the Task 5 UI or `POST /api/availability`).
- [ ] Over MCP (real client), call: *"Schedule the team call from everyone's standing availability for <list>, 60 minutes, next week."*
- [ ] **Verify:** a slot is returned with the counted participants, **no poll record was created** (`list_my_polls` unchanged; no new `chat.avails.scheduling.poll`), and the thin-coverage path falls back to a poll instead of booking. This is the Phase-1 done criterion (#2) and the differentiator vs LettuceMeet/When2Meet.

---

## Self-Review

- **Spec coverage.** #102 record → Tasks 1–3; #102 UI → Task 5; #102 scope-as-reference/visibility/trust → GATE 1 + Task 1; #103 tool → Tasks 6–8; #103 fallback-to-poll + trust two-sidedness (participant half) → Task 8; #103 reuse-the-solver → Task 7. CA-scoped path, private-DB storage, the Telegram/MC trigger, and community trust-mode are **out of Phase 1** by design (Phases 2–4).
- **Type consistency.** `scope {type,value}`, `pattern.weekly [{day,startTime,endTime}]`, `trust confirm|auto` used identically across lexicon (T1), validator (T2), route (T3), resolver (T6), overlap (T7), tool (T8).
- **Deferred, tracked, not silently dropped:** `pattern.dateRanges` (reserved in lexicon, not surfaced); auto-creating the fallback poll (Task 8 returns the signal, doesn't build it); OpenMeet/community-native `calendar.event` publish of the booked call; a neutral `community.lexicon.*` availability lexicon proposal.

## Execution Handoff

Choose after review: **(1) Subagent-driven** (fresh subagent per task, review between) or **(2) Inline** (this session, checkpoints). Task 5 (UI) always runs through `impeccable` + shadcn MCP regardless.
