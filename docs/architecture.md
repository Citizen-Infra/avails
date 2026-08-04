# Avails Architecture Reference

Read this file when working on avails internals. Not loaded every session — referenced from CLAUDE.md.

## Two services, one repo

- **Server** (`server/`): Express 4, ES modules. Handles ATProto OAuth, XRPC calls to PDSes, email via Resend, session persistence to Railway volume.
- **Client** (`client/`): React 19 SPA. Vite builds to `client/dist/`, served as static files by Express in production.

## Data model — no database

There is no database. ATProto PDS is the data store:
- **Polls**: `chat.avails.scheduling.poll` records in creator's PDS
- **Responses**: `chat.avails.scheduling.response` records. New responses are written to avails' **own service repo** (see [Service identity](#service-identity)); pre-#42 responses remain in the creator's PDS. Reads merge both. When the service identity is unconfigured, writes fall back to the creator's PDS via the creator's OAuth session (the legacy behavior).
- **Standing availability**: `chat.avails.scheduling.availability` records in the **participant's own PDS** — the one record type that isn't creator-hosted. See [Standing availability](#standing-availability) below.
- **Poll index**: Map (`lib/pollIndex.js`) for community-based discovery. Persisted to Railway volume via `persistence.js` (auto-save every 30s, restored on startup).
- **Sessions**: persisted to Railway volume as JSON (`/data/oauth-sessions.json`, `/data/app-sessions.json`). Loaded on startup, then pruned locally; the live OAuth session is rebuilt lazily on the first request that needs it, never at boot (#117).

## ATProto OAuth flow

1. User enters Bluesky handle → server redirects to ATProto auth server
2. Auth server redirects back to `/api/auth/callback`
3. Server stores OAuth session (keyed by DID) + app session (keyed by cookie)
4. Creator's OAuth session is used for the creator's own PDS writes (poll create/finalize/unschedule). Participant **responses** no longer ride the creator's session — they go to avails' service repo (see [Service identity](#service-identity)); only the legacy fallback path still uses the creator's session for responses.
5. Private key for `private_key_jwt` auth stored as base64-encoded JWK in `ATPROTO_PRIVATE_KEY` env var

## Service identity

avails has its own ATProto account (a `did:plc`, app-password auth — **not** OAuth; #77 investigated did:web and deferred it). `lib/serviceSession.js` logs in via `com.atproto.server.createSession` and refreshes on expiry, exposing authenticated `serviceCreateRecord`/`servicePutRecord`/`serviceDeleteRecord`/`serviceGetRecord`.

**The account (activated + verified in prod 2026-08-02):** handle `avails.bsky.social`, DID `did:plc:3ym2jg7sqlncwowz33rmevjh`, PDS `fibercap.us-west.host.bsky.network`. `AVAILS_SERVICE_IDENTIFIER` (the handle or DID) + `AVAILS_SERVICE_APP_PASSWORD` (an **app password**, not the login password) are set on Railway; `AVAILS_SERVICE_PDS` is left unset (defaults to `https://bsky.social` for login; the real PDS is resolved from the DID). Real-PDS smoke: an unauthenticated response POST returned 201 and the record landed in the service repo (not the creator's), DELETE routed to the service repo, cleanup confirmed.

- **Why:** a poll response used to be written with the *creator's* OAuth session into the creator's PDS, so a signed-out creator meant participants got a 503 (#72, #117). Responses now write to avails' own repo, decoupled from any user session.
- **Feature-flagged (`isServiceConfigured()`):** true iff `AVAILS_SERVICE_IDENTIFIER` + `AVAILS_SERVICE_APP_PASSWORD` are set. Unset → every response route falls back to the legacy creator-session path unchanged, so the code deploys as a no-op until the env vars activate it.
- **Reads** (`lib/responseReads.js`) merge two public `listRecords` — creator repo (legacy) + service repo (new), paged and filtered by `pollUri`, each tagged `home: 'creator' | 'service'`. Public/unauthenticated; a read never depends on the service *login*, only on resolving the service DID.
- **Edit/delete** disambiguate with a service `getRecord`: a record present in the service repo is edited there; otherwise the creator-session legacy path handles it (pre-migration records only).
- **Scope note (Stage 1):** Stage 2 — authenticated respondents writing to *their own* PDS — and private-scope responses are out of scope (avails#42).

## Server infrastructure

- **Request logging** — all `/api` requests logged with method, path, status, duration
- **JSON error middleware** — all API errors return `{ error: "message" }` with proper status codes, not HTML
- **Rate limiting** — per IP: auth 20/hr, poll creation 30/hr, responses 60/hr. `trust proxy` enabled for Railway.
- **Input validation** — `middleware/validate.js` whitelists fields and validates types/ranges for poll creation, update, and response submission. Routes use `req.validatedBody` (not `req.body`) to prevent field injection.
- **Env var validation** — required vars checked at startup, exits with clear message if missing
- **ErrorBoundary** — React ErrorBoundary wraps entire app + extra wrapper around PollView. Shows fallback UI instead of white screen.
- **Unhandled rejection handler** — catches ATProto OAuth SDK's async TokenRefreshError to prevent crash loops

## Key gotchas (full context)

- **Never restore OAuth sessions at boot** (#117) — `client.restore(did)` refreshes the token against the user's PDS authorization server, and *that server* fetches our `client_id` URL to validate the `private_key_jwt` we send. The fetch is made by bsky.social, not by us, so it needs our **public host** to be reachable — and Railway's edge does not route to a fresh container until its health check passes. Boot lost that race on roughly half of deploys. This was long described here as "the OAuth client fetches client-metadata from itself, so restore must run after `app.listen()`"; the ordering advice was right by accident, the mechanism was wrong, and it implied a local fix existed. None does: the fetcher is remote. Restores belong on the request paths (`requireAuth`, `findOauthSessionByDid`, `mcp/handler.js`), which by definition run only once the edge is routing.
- **Responses write to avails' service repo, not the creator's session** (#42) — see [Service identity](#service-identity). The creator's session is off the response path when the service identity is configured; the legacy fallback (creator-session write, which can 503 if the creator is signed out) applies only when it isn't.
- **Old polls use different field names** — `earliestTime`/`latestTime`/`slotDuration` vs `timeRange`/`slotMinutes`. PollView has fallback handling for both formats.
- **React render loops and hooks** — AvailGrid is sensitive to unstable object references in props. Never pass `new Set()` or `{}` inline as prop defaults. Use module-level constants (`const EMPTY_SET = new Set()`) and assign fallbacks in the function body, not destructuring. The SchedulingGrid was created as a separate component (instead of adding props to AvailGrid) specifically to avoid this. Also: never place hooks (`useMemo`, `useEffect`, etc.) after early returns — React error #310 ("Rendered more hooks than during the previous render").
- **Document-level event handlers and stale closures** — AvailGrid attaches `pointerup`/`pointermove` to `document`. These handlers must use refs (not state) to read mutable values, or the `useCallback` dependency array causes constant listener teardown/re-add. Pattern: `activeSlotRef` mirrors `activeSlot` state; handler reads ref, state is only for rendering.
- **CabbageMeet-style mode separation in grid** — viewing mode shows heatmap only, editing mode shows my slots only. Never mix the two (causes visual double-counting).
- **`@atproto/lex` generated TypeScript** — server is plain JS, so generated TS in `server/src/lexicons/` is for type reference only. Server uses raw XRPC fetch calls.
- **Google Calendar** — queries all owner/writer calendars (not just primary). Skips holidays/birthdays by name. Filters out transparent (show as available) and declined events.
- **Poll edit strips old field names** — when editing a poll created with `earliestTime`/`latestTime`/`slotDuration`, the PUT handler removes these before writing to PDS (lexicon rejects unknown fields).
- **Timezone conversion** — slot keys are stored in the creator's timezone (not UTC — see #33 for future migration). `client/src/lib/timezone.js` converts between creator's TZ and viewer's local TZ using **Luxon** (`DateTime.fromObject` with zone). Grid shows viewer's local times. Responses converted back to creator's TZ on save. Per-slot conversion handles DST correctly (better than CabbageMeet's first-date-only approach).
- **PDS data can be corrupted** — `normalizeResponses()` in PollView.jsx ensures every response has `slots: []` and `name: 'Unknown'` before entering React state. Never access `r.slots` or `r.name` without this normalization layer. All `setResponses` calls MUST go through `normalizeResponses`.
- **.ics timezone handling** — `ical-generator` with a `timezone` property stamps TZID on DTSTART but doesn't convert the Date from UTC. Don't pass `timezone` — use UTC times and let calendar apps convert. The `location` field is intentionally empty — Avails doesn't know where people meet (Zoom, Meet, offline). Needs integration with conferencing tools to fill it.
- **Finalize endpoint collects emails server-side** — the PUT finalize route fetches responses from PDS to get participant names and emails, rather than relying solely on the client. Both MCP `schedule` tool and REST endpoint follow this pattern.
- **Date formatting must use local time** — never use `toISOString().slice(0, 10)` for dates. It converts to UTC which shifts dates for UTC+ timezones. Use `getFullYear()`/`getMonth()`/`getDate()` or the `formatDateLocal()` helper.

## OpenMeet integration

[OpenMeet](https://github.com/OpenMeet-Team/openmeet-api) is an open-source event platform on ATProto. Two integration points + groups exploration:

1. **Event publishing** (`POST /api/openmeet/publish` + MCP `publish_to_openmeet`): creates an OpenMeet event from a finalized poll. Uses `POST /api/events` (not `/api/integration/events`) with ATProto service auth.

2. **Calendar availability** (`POST /api/openmeet/availability`): fetches calendar events. Response shape: `{ events: [...], totalCount, dateRange }` — access `.events` array.

Both use ATProto service auth flow:
   - Call `com.atproto.server.getServiceAuth` on user's PDS with `aud: did:web:api.openmeet.net`, `lxm: net.openmeet.auth`
   - PDS signs a JWT → exchange at OpenMeet's `POST /api/v1/auth/atproto/service-auth`
   - Requires `rpc:net.openmeet.auth?aud=*` in OAuth scopes. The pinned DID form (`aud=did:web:api.openmeet.net`) was silently dropped from the consent grant by bsky; the wildcard form is what OpenMeet's own documentation recommends.
   - **#49 gotcha** — ATProto OAuth doesn't re-prompt for upgraded scopes on existing grants. Rotate the `client_id` (client-metadata URL version bump) to force re-consent for every user with the current scope set.

3. **Groups** (#50): OpenMeet has ATProto-native group management ("Groups you organize" / "Groups you're part of"). Could serve as shared community layer for poll scoping — explore once scope issue is resolved.

Calendar priority chain: OpenMeet (auto for signed-in users) → Google Calendar (manual connect fallback) → nothing (anonymous).

**OpenMeet tenant ID**: The public instance uses `lsdfaopkljdfs` (not `1`). Set via `OPENMEET_TENANT_ID` env var, defaults to this value.

## Standing availability

Phase 1 (Bluesky-list scope only) of the "publish availability once, let an agent book from it" feature. A participant tells avails when they're generally free for a specific group's calls — once — and `schedule_call` books a call from everyone's records. No poll, no per-invite grid-painting.

### Record: `chat.avails.scheduling.availability`

A deliberate break from `chat.avails.scheduling.response`: this record lives in the **participant's own PDS** (`repo = participant DID`), not the creator's. The participant owns it and can revoke it directly — nobody else can write into it.

Fields:
- `scope: { type: 'atproto-list' | 'ca-community', value }` — the single group this offer is for. Phase 1 only writes/accepts `atproto-list` (`value` = an `at://…/app.bsky.graph.list/…` URI). `ca-community` (a community-admin community id, for private communities) is Phase 3 — rejected today by both the validator and `schedule_call`.
- `pattern: { weekly: [{ day: 0-6, startTime: 'HH:MM', endTime: 'HH:MM' }], dateRanges?: [] }` — `day` follows JS `getDay()` (0 = Sunday). `dateRanges` is reserved: accepted and stored by the lexicon, not yet surfaced in the UI or the overlap solver.
- `timezone` — IANA zone; weekly windows are interpreted in it.
- `trust: 'confirm' | 'auto'` — `confirm` (default) means an agent must ask before booking into this person's windows; `auto` means it may book without asking.
- `validUntil` — expiry, default 8 weeks from publish, so a stale pattern-of-life record decays instead of lingering permanently on the firehose (list-scope records are public and un-retractable once published).
- `createdAt` / `updatedAt`.

One record per `scope.value` — publishing again for the same list replaces the prior record (list existing records, then `putRecord`/`createRecord`) rather than creating a duplicate.

### REST: `/api/availability` (`server/src/routes/availability.js`)

- `POST /` — create-or-replace the caller's record for a scope. Auth required; writes to the caller's own PDS via `req.oauthSession`. Validated by `server/src/lib/availabilityValidate.js` (field whitelist, `HH:MM` regex + start<end, day 0-6, `trust` enum, ISO `validUntil`) — the route reads `req.validatedBody`, never `req.body`, per the project's write-endpoint convention.
- `GET /mine` — list the caller's own records (public PDS read).
- `DELETE /:rkey` — delete one of the caller's own records. No `:did` param: the collection always lives in the caller's own PDS, so there's no cross-user delete surface to guard.

Client page: `/availability` route → `client/src/pages/StandingAvailability.jsx` (scope picker that resolves a Bluesky list via `app.bsky.graph.getList` before enabling publish, `WeeklyPatternGrid.jsx` for painting recurring windows, timezone/trust/validUntil controls, publish/edit/delete). `WeeklyPatternGrid` mirrors `SchedulingGrid`'s single-column drag + roving-tabIndex keyboard model (not `AvailGrid`'s multi-column rectangle select) but, unlike `SchedulingGrid`, must hold several non-contiguous windows per day — a committed drag/keypress toggles cells rather than replacing one active block.

### Discovery + booking (MCP-only, no REST surface)

- **`server/src/mcp/listMembers.js`** — `resolveListAvailability(listUri)`: pages `app.bsky.graph.getList` on the public AppView for member DIDs, then for each member resolves their PDS and lists their availability records, keeping the latest one scoped to *this* list whose `validUntil` hasn't passed. All PDS calls are timeout-guarded (`fetchWithTimeout`, 10s) and per-member failures are non-fatal (`Promise.allSettled` — a hung or erroring member's PDS skips that member instead of failing the whole resolution).
- **`server/src/mcp/availabilityOverlap.js`** — `bestCallSlots({ members, window, durationMinutes })`: expands each member's `pattern.weekly` into duration-aligned candidate slots across the requested date window, converting every candidate to a common **UTC grid** (Luxon `DateTime.fromObject` in the member's own timezone, then `.toUTC()`) before handing the flattened per-member slot lists to the existing `computeBestSlots` (`overlap.js`). Necessary because `computeBestSlots` only matches slot-key strings and has no timezone awareness of its own — two members "free at 14:00" in different zones are free at different absolute instants unless converted first. New server dependency: **luxon** (DST-safe timezone math).
- **`schedule_call` MCP tool** (`server/src/mcp/tools.js`) — no-auth-required booking flow: resolve `scope` → `resolveListAvailability` → `bestCallSlots` → coverage check → trust split → book. Coverage floor (`MIN_CALL_COVERAGE = 2`): fewer than 2 members with a record, or a top slot with fewer than 2 people free, returns `{ booked: false, fallback: 'create_poll', reason }` instead of booking — it signals the fallback, it does not create the poll itself. On a bookable slot, members with `trust: 'auto'` are auto-booked; everyone else (including any unrecognized or missing trust value) lands in `needsConfirm`, never silently committed. Reuses `generateIcs` (called correctly here, object-form — see Known Phase-1 limitations below for a related pre-existing bug) and best-effort `sendEmail` to any member record carrying an email (rare — email isn't a lexicon field). **No poll record is created anywhere on the success path** — that's the Phase-1 done criterion.

Phase 1 is list-scope only. `ca-community` scoping (private community-admin communities, which aren't public PDS-discoverable the way a Bluesky list is) is Phase 3 and is rejected at both the validator and `schedule_call` layers today.

### Known Phase-1 limitations

- **DST spring-forward gap** — `availabilityOverlap.js`'s slot expander builds each candidate with Luxon `DateTime.fromObject` in the member's timezone. Luxon resolves a non-existent wall-clock time inside a spring-forward gap (e.g. 02:30 on a US DST-transition date) to `isValid: true` using the pre-transition offset, so a slot starting inside that ~1h gap gets a UTC key off by an hour. Narrow in practice (only the transition date, in a DST-observing zone, for a window straddling the gap) and same-zone overlap detection stays sound regardless. A real fix (explicit UTC-offset comparison) is a fast-follow, not done in Phase 1.
- **One-record-per-scope isn't atomic** — `POST /api/availability` lists the caller's existing records for the scope, then writes the replacement. Under concurrent POSTs for the same scope this list-then-write is a race; a rare duplicate record can result.
- **"Valid until" display uses the browser's local timezone** — the published-record list in `StandingAvailability.jsx` formats `validUntil` with `toLocaleDateString()`, but the write path anchors it at UTC midnight (`${date}T00:00:00Z`). A user in a UTC-negative offset (most of the Americas) can see a date one day earlier than the record's actual intent.
- **Pre-existing, unrelated bug surfaced while building this feature — the MCP `schedule` tool's finalize path calls `generateIcs` positionally.** `generateIcs` (`server/src/lib/ical.js`) takes a single destructured options object: `{ poll, pollUrl, did, rkey, participants, method }`. `schedule_call`'s booking path and both REST finalize routes (`routes/polls.js`) call it correctly with that object. But the older MCP `schedule` tool's finalize path (`server/src/mcp/tools.js` ~line 580: `generateIcs(updatedRecord, url, participants)`) passes it positionally — `updatedRecord` becomes the sole argument, so `poll` destructures to `undefined` and the call throws (`Cannot read properties of undefined (reading 'finalTime')`) the moment anyone finalizes a poll via the MCP `schedule` tool. Not introduced by this epic and not fixed by it — needs its own fix.

## Client architecture

### Pages
- `Landing.jsx` — hero (unauthenticated) or My Polls + PollCreator (authenticated)
- `PollView.jsx` — main poll page: grid + responses + scheduling
- `About.jsx` — Citizen Infra ecosystem info
- `Privacy.jsx`, `Terms.jsx` — legal pages (required for Google OAuth consent screen)

### Key components
- `AvailGrid.jsx` — drag-to-paint availability grid. Rectangle selection, commit-on-pointerup, document-level listener. Heatmap from responses, hover tooltips, busy slots overlay. **Paginated** — max 7 dates visible with left/right arrows. Touch drag uses `pointermove` + `elementFromPoint()` (not `pointerenter`, which doesn't fire during touch). Tap-to-highlight in read-only mode uses `activeSlot` state + `activeSlotRef` ref (ref avoids stale closures in document listeners).
- `Logo.jsx` — shared 4x4 heatmap grid icon representing overlapping availability. Used in all page headers.
- `SchedulingGrid.jsx` — separate grid for creator scheduling mode. Single-column vertical drag, teal preview. Completely independent from AvailGrid to avoid render loop issues.
- `GuestModal.jsx` — "Continue as guest" dialog: name + optional email. Shown when anonymous user clicks Save after painting.
- `PollCreator.jsx` — single-page poll creation form
- `ResponsePanel.jsx` — sidebar with participant list, bidirectional hover/tap sync with grid. Available names get green checkmark, unavailable dimmed on slot hover/tap.

### Design system
- Warm off-white background: `#faf9f6`
- Teal accent: `#0d9488` (buttons, links, interactive elements)
- Text hierarchy: `#1a1a1a` (headings), `#6b6560` (body), `#a09a94` (muted)
- Borders: `#e8e5df`
- Font: Geist Variable (via @fontsource-variable/geist)
- shadcn/ui components in `client/src/components/ui/`

## MCP endpoint

Embedded `POST /mcp` JSON-RPC endpoint with ATProto OAuth (Smoke Signal pattern). Nine tools:

| Tool | Auth | Description |
|------|------|-------------|
| `get_poll` | No | Poll details + responses + best slots ranked by overlap |
| `list_polls` | No | List by community and/or status |
| `list_communities` | No | All communities with named topics |
| `create_poll` | Yes | Create scheduling poll |
| `list_my_polls` | Yes | User's polls from PDS |
| `schedule` | Yes | Set time, close poll, send invites |
| `share_poll` | Yes | Post to Telegram channel or group topic |
| `publish_to_openmeet` | Yes | Create OpenMeet event from finalized poll |
| `schedule_call` | No (optional) | Book a call from members' standing availability — no poll. Resolves a Bluesky-list scope → members' records → best UTC overlap; coverage fallback to a poll + trust split. |

### OAuth

Standard OAuth 2.0 discovery (RFC 9728 + 8414) with PKCE S256 — Claude Code handles auth automatically. Granular ATProto scopes: `repo:chat.avails.scheduling.poll`, `repo:chat.avails.scheduling.response`, `repo:chat.avails.scheduling.availability`, `rpc:net.openmeet.auth?aud=*`.

MCP OAuth flow piggybacks on the web UI's ATProto OAuth — `/api/auth/callback` detects MCP flows via `tryMcpCallback()` (exported from `mcp/oauth.js`) and redirects to the MCP client instead of the homepage.

The client-metadata route is versioned — `repo:chat.avails.scheduling.availability` bumped it from `/api/auth/client-metadata-v3.json` to `-v4.json` — because ATProto caches OAuth grants per `client_id` and never re-prompts an existing user for an upgraded scope set (#49); rotating the URL is the only way to force fresh consent.

**DEPLOY-ORDERING caveat:** Railway redeploys on a push **and** on an env-var change, so a naive rotation deploys twice and breaks sign-in in the gap — either direction. Env pointing at a `-v4.json` route the old code doesn't serve yet, or new code that's dropped `-v3.json` while env still points there: both are a real outage for the length of a build, not a blip. Note the env var can't literally travel "in the same push" — it isn't in the repo.

**Use `skip_deploys`.** Stage the env var *without* triggering a redeploy, then let the merge's build be the only deploy. A running container keeps the env it started with, so production stays on self-consistent old-code + old-env until the new container comes up with new-code + new-env **together**. There's no gap because there's no intermediate deploy.

```
1. Stage the env — explicitly no redeploy:
     MCP: set_variables({ATPROTO_CLIENT_ID: "https://<host>/api/auth/client-metadata-vN.json"}, skip_deploys: true)
     CLI: railway variables --set ATPROTO_CLIENT_ID=<...>-vN.json --skip-deploys
2. Confirm nothing deployed — list_deployments, newest entry must be unchanged.
   (If skip_deploys silently didn't hold, prod is now old-code + new-env = sign-in down. Check, don't assume.)
3. Merge the PR that renames the route. That build is the only deploy.
4. Verify: the -vN.json route 200s AND its client_id field equals the env var exactly
   (ATProto requires client_id == the URL it's served from).
5. POST /api/admin/clear-sessions?key=SESSION_SECRET
```

Verified on the v3→v4 rotation (2026-07-17): **zero sign-in downtime**. Step 5 clears existing users' cached pre-upgrade grants so they re-consent on next sign-in (#49) — the rotation only forces re-consent for *new* sign-ins, while stored server-side sessions keep old grants that lack the new scope.

Boots used to log `Failed to restore OAuth session … invalid_client_metadata` about half the time after a rotation, which read as the rotation having failed when it hadn't. That was the startup race, and the startup restore is gone (#117), so the line should no longer appear at all. If it does, it is coming from a request path and is worth investigating rather than dismissing.

### Admin endpoint

`POST /api/admin/clear-sessions?key=SESSION_SECRET` — clears all OAuth + app sessions. Needed when scopes change (ATProto doesn't re-prompt for upgraded scopes on an existing grant).

### share_poll — topic resolution

`share_poll` posts to a community's Telegram channel or group topic. The `topic` param resolves in order:
1. **Named topic from community config** — use topic names from `groups.json` (e.g., `topic: "events"`, `topic: "links"`)
2. **Numeric thread ID** — pass raw Telegram thread ID (e.g., `topic: "902"`)
3. **Omitted** — posts to the community's output channel

**Always prefer named topics over numeric IDs.** The community config has these topics:

| Community | Topics |
|-----------|--------|
| scenius | links, memes, events, ai-tools-library |
| cibc | news, resources, events |
| nsrt | links, events |

## Known architectural debts

- ~~**Response storage coupled to creator session** (#42)~~ — RESOLVED (Stage 1) by the service identity: new responses write to avails' own repo, reads merge creator+service (see [Service identity](#service-identity)). Remaining: Stage 2 (authenticated respondents own their responses in their own PDS) and private-scope responses.
- **OAuth scope upgrade doesn't re-prompt** (#49) — ATProto OAuth caches grants; adding new scopes (like the OpenMeet RPC scope) doesn't trigger re-consent. Use admin clear-sessions endpoint + wait for bsky.social propagation (up to 15 min).
- **No OG metadata** (#46) — poll links show no preview in Telegram/Slack/social media.
- **ATProto DID URLs** (#45) — poll URLs contain long DIDs; slug-based URLs planned.
- ~~**No persistent availability** (#47)~~ — RESOLVED by the standing-availability feature (`chat.avails.scheduling.availability`, Phase 1, list-scope only — see [Standing availability](#standing-availability)). Participants publish availability once per group; `schedule_call` books from it directly. `ca-community` scope (private community-admin communities) is Phase 3 and still open.
- **Self-service community connection** (#44) — users can't connect their own Telegram groups; blocked by community-admin.

## Related Projects

- **my-community** (`../my-community/`) — has avails poll banners in participation feed (store/avails.js + AvailsBanner.jsx)
- **navidrome-jam** (`../navidrome-jam/`) — reference for Express + Railway + volume persistence patterns
- **community-admin** (`../community-admin/`) — parent ecosystem
