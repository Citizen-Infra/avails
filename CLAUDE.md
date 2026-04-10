# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- EXPERIMENT: This file uses <important if="condition"> blocks (HumanLayer pattern) to
improve instruction adherence. However, ETH Zurich research (arxiv.org/abs/2602.11988) found
that detailed context files reduce agent success rates by 3% and increase cost by 20%.
Only specific commands and hard constraints reliably help. Architecture overviews and component
descriptions may hurt. This structure is an experiment — measure before applying elsewhere. -->

**Avails** — open-source ATProto-powered group scheduling tool. Express server + React 19 SPA (Vite 7, Tailwind v4, shadcn/ui). No database — ATProto PDS is the data store.

**Scope: time-finding, not event management.** Avails finds a common available time. It is NOT an event platform, RSVP system, or calendar app. Those are complementary.

## Project map

- `server/` — Express 4, ES modules. ATProto OAuth, XRPC calls, email (Resend), session persistence to Railway volume.
- `client/` — React 19 SPA. Vite builds to `client/dist/`, served as static files by Express in production.
- `lexicons/` — ATProto lexicon schemas for polls and responses.

## Data model — no database

- **Polls**: `chat.avails.scheduling.poll` records in creator's PDS
- **Responses**: `chat.avails.scheduling.response` records in creator's PDS (anonymous responses use creator's stored OAuth session)
- **Poll index**: in-memory Map (`lib/pollIndex.js`), persisted to Railway volume every 30s
- **Sessions**: JSON on Railway volume (`/data/oauth-sessions.json`, `/data/app-sessions.json`)

<important if="you need to run commands to build, test, lint, or generate code">

## Commands

```bash
# Server
cd server && npm install && npm run dev    # Dev with hot-reload (node --watch)
cd server && npm start                      # Production

# Client
cd client && npm install && npm run dev    # Vite dev server (localhost:5173, proxies /api to :3000)
cd client && npm run build                 # Production build → dist/

# Lexicon codegen (after editing lexicons/*.json)
npx @atproto/lex build --lexicons ./lexicons --out ./server/src/lexicons --indexFile

# Tests (Node built-in test runner)
cd server && npm test                      # All tests (validation + route integration)

# Server syntax check
node --check server/src/index.js
```

Tests use `node:test` + `node:assert`. Integration tests require `--experimental-test-module-mocks`.
- `test/validate.test.js` — validation middleware (23 tests)
- `test/responses.test.js` — response routes with mocked PDS/session (10 tests)

</important>

<important if="you are adding or modifying server routes, middleware, or API endpoints">

## Server rules

- **Every write endpoint MUST have validation middleware** — `middleware/validate.js` whitelists fields and validates types/ranges. Routes use `req.validatedBody` (not `req.body`). A missing middleware caused silent data corruption (2026-04-07).
- Session restore must happen AFTER `app.listen()` — OAuth client fetches `client-metadata.json` from itself during restore. Starting before listening = deadlock.
- Anonymous responses require creator's OAuth session — if it expires, participants can't submit.
- Rate limiting: auth 20/hr, poll creation 30/hr, responses 60/hr per IP. `trust proxy` enabled for Railway.
- All API errors return `{ error: "message" }` JSON, not HTML.
- Finalize endpoint collects emails server-side from PDS, not from client payload.

</important>

<important if="you are modifying AvailGrid, SchedulingGrid, or the drag/selection grid components">

## Grid component rules

- **Never pass `new Set()` or `{}` inline as prop defaults.** Use module-level constants (`const EMPTY_SET = new Set()`). AvailGrid is sensitive to unstable references — causes render loops.
- **Never place hooks after early returns** — React error #310.
- **Document-level event handlers must use refs, not state** — `useCallback` dependency arrays cause constant listener teardown. Pattern: ref mirrors state; handler reads ref, state is for rendering.
- **CabbageMeet-style mode separation** — viewing mode = heatmap only, editing mode = my slots only. Never mix (causes visual double-counting).
- **SchedulingGrid is separate from AvailGrid** — specifically to avoid render loop issues. Don't merge them.
- Touch drag uses `pointermove` + `elementFromPoint()` (not `pointerenter`, which doesn't fire during touch).

</important>

<important if="you are working with dates, times, timezones, or slot keys">

## Timezone and date rules

- Slot keys are stored in creator's timezone (not UTC). `client/src/lib/timezone.js` converts between creator's TZ and viewer's local TZ using Luxon.
- **Never use `toISOString().slice(0, 10)` for dates** — converts to UTC, shifts dates for UTC+ timezones. Use `getFullYear()`/`getMonth()`/`getDate()` or `formatDateLocal()`.
- Old polls use `earliestTime`/`latestTime`/`slotDuration` vs current `timeRange`/`slotMinutes`. PollView has fallback handling. Poll edit strips old field names before writing to PDS.

</important>

<important if="you are working with PDS data, responses, or the normalizeResponses function">

## PDS data integrity

- PDS data can be corrupted. `normalizeResponses()` in PollView.jsx ensures every response has `slots: []` and `name: 'Unknown'`. **All `setResponses` calls MUST go through `normalizeResponses`.**

</important>

<important if="you are working with OpenMeet integration, calendar availability, or event publishing">

## OpenMeet integration

- Event publishing: `POST /api/openmeet/publish` — uses `POST /api/events` (not `/api/integration/events`) with ATProto service auth.
- Calendar availability: `POST /api/openmeet/availability` — response shape: `{ events: [...], totalCount, dateRange }` — access `.events` array.
- Service auth flow: `getServiceAuth` → PDS signs JWT → exchange at OpenMeet `POST /api/v1/auth/atproto/service-auth`.
- **Blocked by #49**: ATProto OAuth doesn't re-prompt for upgraded scopes. Users authorized before the scope was added can't use OpenMeet features until re-consent is forced.
- Calendar priority: OpenMeet (auto for signed-in) → Google Calendar (manual connect) → nothing (anonymous).
- OpenMeet tenant ID: `lsdfaopkljdfs` (not `1`). Set via `OPENMEET_TENANT_ID` env var.

</important>

<important if="you are working with Google Calendar integration or .ics file generation">

## Calendar rules

- Google Calendar queries all owner/writer calendars (not just primary). Skips holidays/birthdays by name. Filters out transparent and declined events.
- `.ics`: don't pass `timezone` to `ical-generator` — use UTC times. The `location` field is intentionally empty.

</important>

<important if="you are working with the MCP endpoint, MCP tools, or share_poll">

## MCP endpoint

Embedded `POST /mcp` JSON-RPC endpoint with ATProto OAuth. Tools:

| Tool | Auth | Description |
|------|------|-------------|
| `get_poll` | No | Poll details + responses + best slots |
| `list_polls` | No | List by community and/or status |
| `list_communities` | No | All communities with named topics |
| `create_poll` | Yes | Create scheduling poll |
| `list_my_polls` | Yes | User's polls from PDS |
| `schedule` | Yes | Set time, close poll, send invites |
| `share_poll` | Yes | Post to Telegram channel or group topic |
| `publish_to_openmeet` | Yes | Create OpenMeet event from finalized poll |

MCP OAuth piggybacks on the web UI's ATProto OAuth — `/api/auth/callback` detects MCP flows via `tryMcpCallback()`.

### share_poll topic resolution

Resolves in order: named topic from `groups.json` → numeric thread ID → community output channel. **Always prefer named topics.** Available:

| Community | Topics |
|-----------|--------|
| scenius | links, memes, events, ai-tools-library |
| cibc | news, resources, events |
| nsrt | links, events |

**Never distribute polls to Telegram without explicit user confirmation.**

</important>

<important if="you are doing visual or UI work on any component">

## UI rules

- Always use `frontend-design` skill for visual/UI tasks.
- Always query shadcn MCP before hand-rolling component CSS.
- When dispatching subagents for UI work, instruct them to use shadcn MCP tools.

</important>

<important if="you are deploying, pushing, or running Railway or infrastructure commands">

## Deployment

Railway (single service, Nixpacks builder). Custom domain: avails.zhgnv.com.
- `railway.json` configures build command, start command, and `watchPatterns`
- `.node-version` = 22 (required for Vite 7 + Tailwind v4)
- Railway volume mounted at `/data` for session persistence

**NEVER use `railway up`, `railway deploy`, or `railway redeploy`.** Railway auto-deploys from GitHub pushes. Using CLI deploy collides with auto-deploy and takes the service down (incident 2026-04-10).

### Preview environment

Preview at `avails-web-preview.up.railway.app`. Fully isolated (own domain, OAuth config, sessions volume).

- Push to `ui-audit-fixes` → auto-deploys preview
- Push to `main` → auto-deploys production
- OAuth configured for preview domain — sign-in works
- Same ATProto PDS data (no database to duplicate)

### Admin

`POST /api/admin/clear-sessions?key=SESSION_SECRET` — clears all OAuth + app sessions. Needed when scopes change.

### Preview environment

Railway preview environment at `avails-web-preview.up.railway.app`. Fully isolated from production (own domain, OAuth config, sessions volume). Deploys from `ui-audit-fixes` branch.

- Push to `ui-audit-fixes` → auto-deploys preview
- Push to `main` → auto-deploys production
- OAuth is configured for the preview domain — sign-in works
- Same ATProto PDS data (no database to duplicate)
- To deploy manually: `railway environment preview && railway service avails-web && railway up --detach`
- **Remember to switch back after**: `railway environment production`

### Environment variables

`ATPROTO_CLIENT_ID`, `ATPROTO_REDIRECT_URI`, `ATPROTO_PRIVATE_KEY` (base64 JWK), `SESSION_SECRET`, `MCP_JWT_SECRET` (optional), `TELEGRAM_BOT_TOKEN`, `RESEND_API_KEY`, `CLIENT_URL`, `DATA_DIR` (`/data`), `VITE_GOOGLE_CLIENT_ID` (optional, baked into client build).

</important>

## Task Tracking

- **Task list**: `~/.claude/tasks/avails/tasks.md`
- **GitHub issues**: tracked in the avails repo

## Known architectural debts

- **Response storage coupled to creator session** (#42)
- **OAuth scope upgrade doesn't re-prompt** (#49) — use admin clear-sessions + wait up to 15 min for bsky.social propagation
- **No OG metadata** (#46)
- **ATProto DID URLs** (#45) — slug-based URLs planned
- **No persistent availability** (#47)
- **Self-service community connection** (#44) — blocked by community-admin

## Related Projects

- `../my-community/` — avails poll banners in participation feed
- `../navidrome-jam/` — reference for Express + Railway + Resend patterns
- `../community-admin/` — parent ecosystem
