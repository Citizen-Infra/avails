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
- **Never restore OAuth sessions at boot.** `client.restore(did)` refreshes against the user's PDS authorization server, and *that server* fetches our `client_id` URL to validate our `private_key_jwt`. The fetch is remote, so it needs our public host reachable — and Railway's edge does not route to a fresh container until the health check passes. No local ordering fixes this; the old "must run after `app.listen()`, it fetches from itself" rule named the wrong fetcher and implied a fix that does not exist. Restores belong on request paths (`requireAuth`, `findOauthSessionByDid`, `mcp/handler.js`), which only run once the edge is routing (#117).
- **Responses write to avails' own service repo (`AVAILS_SERVICE_*`); the creator's session is not on the response path** (#42). When the service identity is unconfigured, the legacy creator-session path applies (and can 503 if the creator is signed out). New response records live in avails' repo; reads merge creator (legacy) + service repos. See `docs/architecture.md` → Service identity.
- **Never pass inline `new Set()` / `{}` as React prop defaults.** Use module-level constants. AvailGrid is sensitive to unstable references — causes render loops.
- **Never place hooks after early returns.** React error #310 ("Rendered more hooks than during the previous render").
- **`AvailGrid` and `SchedulingGrid` duplicate the grid** (layout, pagination, drag-select, and keyboard/ARIA) — they render the same data and must stay in sync; a change to one almost always belongs in both. Both are keyboard-operable (roving `tabIndex` + arrow/Space) and viewport-aware; preserve that. The availability heatmap's redundant non-color cue is interaction-based (tap-to-reveal + aria-label count), not an in-cell number — see DESIGN.md.
- **All `setResponses` calls MUST go through `normalizeResponses()`.** PDS data can be corrupted — the normalizer ensures `slots: []` and `name: 'Unknown'`.
- **Date formatting must use local time.** Never `toISOString().slice(0, 10)` — it shifts dates for UTC+ timezones. Use `formatDateLocal()` helper.
- **Old polls use different field names.** `earliestTime`/`latestTime`/`slotDuration` vs `timeRange`/`slotMinutes`. PollView has fallback handling.
- **Never distribute polls to Telegram without explicit user confirmation.**
- **An identifier a caller pins is a list, not a value.** `CORS_ORIGINS` exists because `CLIENT_URL` was doing three jobs at once — CORS allow-origin, redirect targets, email links — and a domain migration wants different values for them at the same moment (#151). The same shape applies to `ATPROTO_CLIENT_ID`: it is host-bound, so consider building client metadata from the **request origin** rather than a fixed env var if avails will ever answer on two hosts during a cutover. Before changing any host-bound value, check consumers' **deploy environments**, not just their repos — `CA_MEMBERSHIP_URL` lives only in Railway and appears in no `.env.example`. Rule + episodes: cibc-brain `decisions/2026-08-03-identifiers-accept-a-set-during-migration.md` (D-08).
- **Never put a secret in a PDS record.** ATProto repo records are **world-readable** — `routes/responses.js` and `routes/polls.js` both fetch poll records unauthenticated, and the MCP's `get_poll` needs no credential at all. #80 proposed storing Google refresh tokens in a lexicon record as "sealed to the user's account"; nothing there is sealed. Encrypting only moves the question to where the key lives, which is the server anyway — so anything secret goes in the encrypted volume, not the repo. The calendar-token decision and its storage are settled in #126: avails **will** hold user calendar refresh tokens (#6), v1 `calendar.readonly`, provider-shaped from day one so Outlook (#3) is additive.
- **Google Calendar insert/cancel failures must never roll back finalize/unfinalize.** PDS state is source of truth; the Google event is a courtesy artifact. Encoded via inner try/catches in `insertGoogleEvent` and `handleUnschedule` — don't "improve" them by letting errors propagate.

## Skills & Design Context

Always use `frontend-design` skill for visual/UI tasks. Always query shadcn MCP before hand-rolling component CSS. When dispatching subagents for UI work, explicitly instruct them to use shadcn MCP tools.

`PRODUCT.md` and `DESIGN.md` (repo root) hold the strategic brief (register=product, users=community/civic organizers, brand, anti-references, WCAG 2.1 AA) and the visual system (North Star "The Village Notice Board", Paper Cream `#faf9f6` ground, single Gather Teal `#0d9488` accent, Geist, flat-with-one-hero elevation). The `impeccable` commands read these — consult them before any UI change so it stays on-brand.

## Deployment

Railway (single service, Nixpacks builder). Custom domain: **avails.citizeninfra.org** (since 2026-08-04, #150). `avails.zhgnv.com` is still a Railway domain on the same service but no longer serves — `LEGACY_HOSTS` makes it 308 to the live host.
- `railway.json` configures build command, start command, and `watchPatterns` (only code changes trigger deploys)
- `.node-version` = 22 (required for Vite 7 + Tailwind v4)
- Railway volume mounted at `/data` for session persistence
- `Procfile`: `web: cd server && node src/index.js`

### Environment variables
- `ATPROTO_CLIENT_ID` — URL to client-metadata.json endpoint (currently `/api/auth/client-metadata-v4.json` — bumped for the standing-availability scope; bump the version + deploy the serving code together, Railway auto-deploys on push, see [architecture.md OAuth](docs/architecture.md#oauth) for the deploy-ordering caveat)
- `ATPROTO_REDIRECT_URI` — OAuth callback URL
- `ATPROTO_PRIVATE_KEY` — base64-encoded ES256 JWK (Railway mangles raw JSON)
- `SESSION_SECRET` — cookie signing
- `MCP_JWT_SECRET` — JWT signing for MCP tokens. Falls back to `SESSION_SECRET` if unset, which is why it must be **set** in production: `SESSION_SECRET` was also an admin credential sent in a URL, so the two were entangled (#156). Changing this value invalidates every outstanding MCP token — clients see "token expired" and must re-run OAuth.
- `MCP_ACCEPTED_ISSUERS` — optional, comma-separated. Extra `iss`/`aud` values accepted on an MCP token alongside the live `CLIENT_URL`. `verifyToken` validates both claims (#156); without this list, changing `CLIENT_URL` — which the `avails.zhgnv.com` → `avails.citizeninfra.org` migration will do (#150) — invalidates every outstanding token at once. Put the old URL here for the duration of the cutover to make it a rollover rather than a flag day. Same shape as community-admin's `CA_ACCEPTED_DIDS`.
- `AVAILS_SERVICE_IDENTIFIER` — avails' own ATProto account (handle or DID) for the service-repo response store (#42). Setting this + `AVAILS_SERVICE_APP_PASSWORD` **activates** the service path; unset = legacy creator-session writes.
- `AVAILS_SERVICE_APP_PASSWORD` — app password for that account (not the login password)
- `AVAILS_SERVICE_PDS` — optional; the account's PDS host for login (default `https://bsky.social`)
- `TELEGRAM_BOT_TOKEN` — Avails bot token for share_poll
- `RESEND_API_KEY` — email service
- `CLIENT_URL` — deployed URL (for redirects and email links). No longer the CORS allowlist — see `CORS_ORIGINS`.
- `CORS_ORIGINS` — optional, comma-separated extra browser origins allowed to call the API (#151). `CLIENT_URL` is always allowed, so leaving this unset preserves the previous single-origin behaviour. During a domain migration, point `CLIENT_URL` at the new host immediately (redirects and email links should move at once) and list the old host here until nothing calls it.
- `LEGACY_HOSTS` — optional, comma-separated hostnames that should 308 to `CLIENT_URL` (#150). Set to `avails.zhgnv.com` after the 2026-08-04 OAuth move: `clientMetadata.client_id` is built from the single `ATPROTO_CLIENT_ID`, so the old host began advertising the new host's `client_id` and ATProto rejects the mismatch — sign-in there is impossible, and forwarding is cheaper than teaching the app two identities. 308 rather than 301 so a POST to `/mcp` from a stale client keeps its method and body. `server/src/middleware/legacyHostRedirect.js` runs after `cors` (browsers do not follow redirects on preflight) and refuses to redirect a host to itself, because that loop would take the whole site down.
- `DATA_DIR` — Railway volume mount path (`/data`)
- `VITE_GOOGLE_CLIENT_ID` — optional, for Google Calendar integration: busy-time overlay, event create on schedule, event cancel on unschedule, writable-calendar picker (baked into client build)
- `OPENMEET_TENANT_ID` — OpenMeet instance tenant (default: `lsdfaopkljdfs`)
- `CA_MEMBERSHIP_URL` — community-admin base URL; used for membership lookup and online `ca-event` grant introspection. A trailing slash is stripped in code.
- `CA_CONFIG_SECRET` — Bearer secret for Community Admin lookups; must equal community-admin's `CA_CONFIG_SECRET`. If unset, gated operations fail closed. Every `ca-event` availability create/replacement introspects online and returns 503 rather than falling back to Bluesky authorization.
- `AVAILS_ADMIN_SECRET` — Bearer credential for `POST /api/admin/clear-sessions`, which logs every user out. Sent as `Authorization: Bearer <value>`, **never** a query parameter: it was previously `SESSION_SECRET` read from `?key=`, which put a secret into access logs, proxy logs, browser history and `Referer` headers, and that same value signed every MCP access token (#156). **Unset = the endpoint denies everything**; it never falls back to another secret. `SESSION_SECRET` and `MCP_JWT_SECRET` must all three be distinct values.
- `AVAILS_SERVICE_SECRET` — Bearer secret that authorizes **inbound** `schedule_call` and read-only `evaluate_availability_overlap` from community-admin. Note the direction: `CA_CONFIG_SECRET` is what avails sends *to* CA, this is what CA sends *to* avails. Deliberately a **separate** value — scenius-digest also holds `CA_CONFIG_SECRET`, so reusing it would let scenius-digest book calls and email people. If unset, service paths are unavailable; it never opens a tool up.

## Task Tracking

- **Task list**: `~/.claude/tasks/avails/tasks.md` — persisted across sessions
- **GitHub issues**: tracked in the avails repo on GitHub

## Reference

Read when working on internals: [Architecture & gotchas](docs/architecture.md) — data model, OAuth flow, components, MCP endpoint (eleven tools, including `delete_poll` — creator-only, allows finalized polls because deleting is error correction, and deliberately leaves service-repo responses alone exactly as the REST delete does (#148) — and `schedule_call` — books a call from standing availability, no poll — and `publish_to_community_feed` — publish/unpublish a poll to its community's My Community feed, creator + membership gated), standing availability, OpenMeet integration, known debts.
