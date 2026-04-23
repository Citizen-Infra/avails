# Avails Architecture Reference

Read this file when working on avails internals. Not loaded every session — referenced from CLAUDE.md.

## Two services, one repo

- **Server** (`server/`): Express 4, ES modules. Handles ATProto OAuth, XRPC calls to PDSes, email via Resend, session persistence to Railway volume.
- **Client** (`client/`): React 19 SPA. Vite builds to `client/dist/`, served as static files by Express in production.

## Data model — no database

There is no database. ATProto PDS is the data store:
- **Polls**: `chat.avails.scheduling.poll` records in creator's PDS
- **Responses**: `chat.avails.scheduling.response` records in creator's PDS (anonymous responses written using creator's stored OAuth session)
- **Poll index**: Map (`lib/pollIndex.js`) for community-based discovery. Persisted to Railway volume via `persistence.js` (auto-save every 30s, restored on startup).
- **Sessions**: persisted to Railway volume as JSON (`/data/oauth-sessions.json`, `/data/app-sessions.json`). Restored on startup AFTER server starts listening (critical — session restore fetches client-metadata from itself).

## ATProto OAuth flow

1. User enters Bluesky handle → server redirects to ATProto auth server
2. Auth server redirects back to `/api/auth/callback`
3. Server stores OAuth session (keyed by DID) + app session (keyed by cookie)
4. Creator's OAuth session is used for all PDS writes (including anonymous participant responses)
5. Private key for `private_key_jwt` auth stored as base64-encoded JWK in `ATPROTO_PRIVATE_KEY` env var

## Server infrastructure

- **Request logging** — all `/api` requests logged with method, path, status, duration
- **JSON error middleware** — all API errors return `{ error: "message" }` with proper status codes, not HTML
- **Rate limiting** — per IP: auth 20/hr, poll creation 30/hr, responses 60/hr. `trust proxy` enabled for Railway.
- **Input validation** — `middleware/validate.js` whitelists fields and validates types/ranges for poll creation, update, and response submission. Routes use `req.validatedBody` (not `req.body`) to prevent field injection.
- **Env var validation** — required vars checked at startup, exits with clear message if missing
- **ErrorBoundary** — React ErrorBoundary wraps entire app + extra wrapper around PollView. Shows fallback UI instead of white screen.
- **Unhandled rejection handler** — catches ATProto OAuth SDK's async TokenRefreshError to prevent crash loops

## Key gotchas (full context)

- **Session restore must happen after `app.listen()`** — the OAuth client fetches `client-metadata.json` from itself during restore. Starting restore before listening causes a deadlock.
- **Anonymous responses require creator's session** — if the creator's session expires or is lost, participants can't submit. Sessions persist to Railway volume to survive deploys.
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

### OAuth

Standard OAuth 2.0 discovery (RFC 9728 + 8414) with PKCE S256 — Claude Code handles auth automatically. Granular ATProto scopes: `repo:chat.avails.scheduling.poll`, `repo:chat.avails.scheduling.response`, `rpc:net.openmeet.auth?aud=*`.

MCP OAuth flow piggybacks on the web UI's ATProto OAuth — `/api/auth/callback` detects MCP flows via `tryMcpCallback()` (exported from `mcp/oauth.js`) and redirects to the MCP client instead of the homepage.

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

- **Response storage coupled to creator session** (#42) — responses written to creator's PDS, sessions persist to volume but architecture limits data ownership and scaling.
- **OAuth scope upgrade doesn't re-prompt** (#49) — ATProto OAuth caches grants; adding new scopes (like the OpenMeet RPC scope) doesn't trigger re-consent. Use admin clear-sessions endpoint + wait for bsky.social propagation (up to 15 min).
- **No OG metadata** (#46) — poll links show no preview in Telegram/Slack/social media.
- **ATProto DID URLs** (#45) — poll URLs contain long DIDs; slug-based URLs planned.
- **No persistent availability** (#47) — users re-enter the same availability for every poll covering the same dates.
- **Self-service community connection** (#44) — users can't connect their own Telegram groups; blocked by community-admin.

## Related Projects

- **my-community** (`../my-community/`) — has avails poll banners in participation feed (store/avails.js + AvailsBanner.jsx)
- **navidrome-jam** (`../navidrome-jam/`) — reference for Express + Railway + volume persistence patterns
- **community-admin** (`../community-admin/`) — parent ecosystem
