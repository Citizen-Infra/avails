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
cd server && npm test                     # All tests (validation + route integration)
```

Server syntax check: `node --check server/src/index.js`

Tests use Node's built-in test runner (`node:test` + `node:assert`). Integration tests require `--experimental-test-module-mocks` for module mocking. Two test files:
- `test/validate.test.js` — unit tests for all validation middleware (31 tests)
- `test/responses.test.js` — integration tests for response routes with mocked PDS/session layer (10 tests)

## Hard Constraints

- **Every write endpoint MUST have validation middleware.** A missing middleware on the PUT response route caused silent data corruption (2026-04-07). Routes use `req.validatedBody` (not `req.body`).
- **Session restore must happen after `app.listen()`.** The OAuth client fetches `client-metadata.json` from itself during restore — starting before listening causes a deadlock.
- **Anonymous responses require creator's session.** If the creator's session expires or is lost, participants can't submit.
- **Never pass inline `new Set()` / `{}` as React prop defaults.** Use module-level constants. AvailGrid is sensitive to unstable references — causes render loops.
- **Never place hooks after early returns.** React error #310 ("Rendered more hooks than during the previous render").
- **All `setResponses` calls MUST go through `normalizeResponses()`.** PDS data can be corrupted — the normalizer ensures `slots: []` and `name: 'Unknown'`.
- **Date formatting must use local time.** Never `toISOString().slice(0, 10)` — it shifts dates for UTC+ timezones. Use `formatDateLocal()` helper.
- **Old polls use different field names.** `earliestTime`/`latestTime`/`slotDuration` vs `timeRange`/`slotMinutes`. PollView has fallback handling.
- **Never distribute polls to Telegram without explicit user confirmation.**
- **Google Calendar insert/cancel failures must never roll back finalize/unfinalize.** PDS state is source of truth; the Google event is a courtesy artifact. Encoded via inner try/catches in `insertGoogleEvent` and `handleUnschedule` — don't "improve" them by letting errors propagate.

## Skills

Always use `frontend-design` skill for visual/UI tasks. Always query shadcn MCP before hand-rolling component CSS. When dispatching subagents for UI work, explicitly instruct them to use shadcn MCP tools.

## Deployment

Railway (single service, Nixpacks builder). Custom domain: avails.zhgnv.com.
- `railway.json` configures build command, start command, and `watchPatterns` (only code changes trigger deploys)
- `.node-version` = 22 (required for Vite 7 + Tailwind v4)
- Railway volume mounted at `/data` for session persistence
- `Procfile`: `web: cd server && node src/index.js`

### Environment variables
- `ATPROTO_CLIENT_ID` — URL to client-metadata.json endpoint
- `ATPROTO_REDIRECT_URI` — OAuth callback URL
- `ATPROTO_PRIVATE_KEY` — base64-encoded ES256 JWK (Railway mangles raw JSON)
- `SESSION_SECRET` — cookie signing
- `MCP_JWT_SECRET` — optional, JWT signing for MCP tokens (falls back to SESSION_SECRET)
- `TELEGRAM_BOT_TOKEN` — Avails bot token for share_poll
- `RESEND_API_KEY` — email service
- `CLIENT_URL` — deployed URL (for redirects and email links)
- `DATA_DIR` — Railway volume mount path (`/data`)
- `VITE_GOOGLE_CLIENT_ID` — optional, for Google Calendar integration: busy-time overlay, event create on schedule, event cancel on unschedule, writable-calendar picker (baked into client build)
- `OPENMEET_TENANT_ID` — OpenMeet instance tenant (default: `lsdfaopkljdfs`)

## Task Tracking

- **Task list**: `~/.claude/tasks/avails/tasks.md` — persisted across sessions
- **GitHub issues**: tracked in the avails repo on GitHub

## Reference

Read when working on internals: [Architecture & gotchas](docs/architecture.md) — data model, OAuth flow, components, MCP endpoint, OpenMeet integration, known debts.
