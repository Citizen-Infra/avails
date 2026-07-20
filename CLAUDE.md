# CLAUDE.md

**Avails** — ATProto-powered group scheduling tool. Polls stored in creator's PDS via custom lexicons.

**Scope: time-finding, not event management.** Not an event platform, RSVP system, or calendar app.

## Commands

```bash
# Server (Express, ES modules, port 3000)
cd server && npm install && npm run dev    # Dev with hot-reload (node --watch)
cd server && npm start                      # Production

# Client (React 19, Vite 7, Tailwind v4, shadcn/ui)
cd client && npm install && npm run dev    # Vite dev server (localhost:5173, proxies /api to :3000)
cd client && npm run build                 # Production build → dist/

# Lexicon codegen (after editing lexicons/*.json)
npx @atproto/lex build --lexicons ./lexicons --out ./server/src/lexicons --indexFile --override
```

```bash
# Tests (Node built-in test runner, no extra dependencies)
cd server && npm test                     # Whole server suite
```

Server syntax check (what CI runs): `find server/src -name '*.js' -not -path '*/lexicons/*' -exec node --check {} +`

Tests use Node's built-in test runner (`node:test` + `node:assert`). The `test` script globs `test/*.test.js`, so **a new test file is gated automatically — never register one by hand.** `--experimental-test-module-mocks` is passed to the whole suite (inert for files that don't call `mock.module`), and Node runs each file in its own process, so per-file `globalThis.fetch` stubs don't leak between them.

**CI runs the full suite and asserts at least one test passed.** `node --test` exits 0 reporting `pass 0` when its glob matches nothing, so a pattern that quietly stops expanding would otherwise leave CI green having run nothing — the guard in `ci.yml` is what makes that fail loudly.

The **client has no test runner** — `cd client && npm run build` is the only client-side gate.

## Hard Constraints

- **Every write endpoint MUST have validation middleware.** A missing middleware on the PUT response route caused silent data corruption (2026-04-07). Routes use `req.validatedBody` (not `req.body`).
- **Session restore must happen after `app.listen()`.** The OAuth client fetches `client-metadata.json` from itself during restore — starting before listening causes a deadlock.
- **Responses write to avails' own service repo (`AVAILS_SERVICE_*`); the creator's session is not on the response path** (#42). When the service identity is unconfigured, the legacy creator-session path applies (and can 503 if the creator is signed out). New response records live in avails' repo; reads merge creator (legacy) + service repos. See `docs/architecture.md` → Service identity.
- **Never pass inline `new Set()` / `{}` as React prop defaults.** Use module-level constants. AvailGrid is sensitive to unstable references — causes render loops.
- **Never place hooks after early returns.** React error #310 ("Rendered more hooks than during the previous render").
- **`AvailGrid` and `SchedulingGrid` duplicate the grid** (layout, pagination, drag-select, and keyboard/ARIA) — they render the same data and must stay in sync; a change to one almost always belongs in both. Both are keyboard-operable (roving `tabIndex` + arrow/Space) and viewport-aware; preserve that. The availability heatmap's redundant non-color cue is interaction-based (tap-to-reveal + aria-label count), not an in-cell number — see DESIGN.md.
- **All `setResponses` calls MUST go through `normalizeResponses()`.** PDS data can be corrupted — the normalizer ensures `slots: []` and `name: 'Unknown'`.
- **Date formatting must use local time.** Never `toISOString().slice(0, 10)` — it shifts dates for UTC+ timezones. Use `formatDateLocal()` helper.
- **Old polls use different field names.** `earliestTime`/`latestTime`/`slotDuration` vs `timeRange`/`slotMinutes`. PollView has fallback handling.
- **Never distribute polls to Telegram without explicit user confirmation.**
- **Google Calendar insert/cancel failures must never roll back finalize/unfinalize.** PDS state is source of truth; the Google event is a courtesy artifact. Encoded via inner try/catches in `insertGoogleEvent` and `handleUnschedule` — don't "improve" them by letting errors propagate.

## Skills & Design Context

Always use `frontend-design` skill for visual/UI tasks. Always query shadcn MCP before hand-rolling component CSS. When dispatching subagents for UI work, explicitly instruct them to use shadcn MCP tools.

`PRODUCT.md` and `DESIGN.md` (repo root) hold the strategic brief (register=product, users=community/civic organizers, brand, anti-references, WCAG 2.1 AA) and the visual system (North Star "The Village Notice Board", Paper Cream `#faf9f6` ground, single Gather Teal `#0d9488` accent, Geist, flat-with-one-hero elevation). The `impeccable` commands read these — consult them before any UI change so it stays on-brand.

## Deployment

Railway (single service, Nixpacks builder). Custom domain: avails.zhgnv.com.
- `railway.json` configures build command, start command, and `watchPatterns` (only code changes trigger deploys)
- `.node-version` = 22 (required for Vite 7 + Tailwind v4)
- Railway volume mounted at `/data` for session persistence
- `Procfile`: `web: cd server && node src/index.js`

### Environment variables
- `ATPROTO_CLIENT_ID` — URL to client-metadata.json endpoint (currently `/api/auth/client-metadata-v4.json` — bumped for the standing-availability scope; bump the version + deploy the serving code together, Railway auto-deploys on push, see [architecture.md OAuth](docs/architecture.md#oauth) for the deploy-ordering caveat)
- `ATPROTO_REDIRECT_URI` — OAuth callback URL
- `ATPROTO_PRIVATE_KEY` — base64-encoded ES256 JWK (Railway mangles raw JSON)
- `SESSION_SECRET` — cookie signing
- `MCP_JWT_SECRET` — optional, JWT signing for MCP tokens (falls back to SESSION_SECRET)
- `AVAILS_SERVICE_IDENTIFIER` — avails' own ATProto account (handle or DID) for the service-repo response store (#42). Setting this + `AVAILS_SERVICE_APP_PASSWORD` **activates** the service path; unset = legacy creator-session writes.
- `AVAILS_SERVICE_APP_PASSWORD` — app password for that account (not the login password)
- `AVAILS_SERVICE_PDS` — optional; the account's PDS host for login (default `https://bsky.social`)
- `TELEGRAM_BOT_TOKEN` — Avails bot token for share_poll
- `RESEND_API_KEY` — email service
- `CLIENT_URL` — deployed URL (for redirects and email links)
- `DATA_DIR` — Railway volume mount path (`/data`)
- `VITE_GOOGLE_CLIENT_ID` — optional, for Google Calendar integration: busy-time overlay, event create on schedule, event cancel on unschedule, writable-calendar picker (baked into client build)
- `OPENMEET_TENANT_ID` — OpenMeet instance tenant (default: `lsdfaopkljdfs`)
- `CA_MEMBERSHIP_URL` — community-admin base URL; `share_poll` gates on membership via `GET /api/memberships` (S4). A trailing slash is stripped in code.
- `CA_CONFIG_SECRET` — Bearer secret for that lookup; must equal community-admin's `CA_CONFIG_SECRET`. If unset, `share_poll` fails closed (denies).

## Task Tracking

- **Task list**: `~/.claude/tasks/avails/tasks.md` — persisted across sessions
- **GitHub issues**: tracked in the avails repo on GitHub

## Reference

Read when working on internals: [Architecture & gotchas](docs/architecture.md) — data model, OAuth flow, components, MCP endpoint (ten tools, including `schedule_call` — books a call from standing availability, no poll — and `publish_to_community_feed` — publish/unpublish a poll to its community's My Community feed, creator + membership gated), standing availability, OpenMeet integration, known debts.
