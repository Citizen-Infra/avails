# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Avails** — open-source ATProto-powered group scheduling tool (LettuceMeet/CabbageMeet alternative). Polls stored as records in creator's PDS via custom lexicons. Part of the Citizen Infrastructure ecosystem.

## Commands

```bash
# Server (Express, ES modules, port 3000)
cd server && npm install && npm run dev    # Dev with hot-reload (node --watch)
cd server && npm start                      # Production

# Client (React 19, Vite 7, Tailwind v4, shadcn/ui)
cd client && npm install && npm run dev    # Vite dev server (localhost:5173, proxies /api to :3000)
cd client && npm run build                 # Production build → dist/

# Lexicon codegen (after editing lexicons/*.json)
npx @atproto/lex build --lexicons ./lexicons --out ./server/src/lexicons --indexFile
```

No test framework configured yet. Server syntax check: `node --check server/src/index.js`

## Architecture

### Two services, one repo

- **Server** (`server/`): Express 4, ES modules. Handles ATProto OAuth, XRPC calls to PDSes, email via Resend, session persistence to Railway volume.
- **Client** (`client/`): React 19 SPA. Vite builds to `client/dist/`, served as static files by Express in production.

### Data model — no database

There is no database. ATProto PDS is the data store:
- **Polls**: `chat.avails.scheduling.poll` records in creator's PDS
- **Responses**: `chat.avails.scheduling.response` records in creator's PDS (anonymous responses written using creator's stored OAuth session)
- **Poll index**: in-memory Map (`lib/pollIndex.js`) for community-based discovery. Ephemeral — rebuilt from PDS reads on restart.
- **Sessions**: persisted to Railway volume as JSON (`/data/oauth-sessions.json`, `/data/app-sessions.json`). Restored on startup AFTER server starts listening (critical — session restore fetches client-metadata from itself).

### ATProto OAuth flow

1. User enters Bluesky handle → server redirects to ATProto auth server
2. Auth server redirects back to `/api/auth/callback`
3. Server stores OAuth session (keyed by DID) + app session (keyed by cookie)
4. Creator's OAuth session is used for all PDS writes (including anonymous participant responses)
5. Private key for `private_key_jwt` auth stored as base64-encoded JWK in `ATPROTO_PRIVATE_KEY` env var

### Server infrastructure

- **Request logging** — all `/api` requests logged with method, path, status, duration
- **JSON error middleware** — all API errors return `{ error: "message" }` with proper status codes, not HTML
- **Rate limiting** — per IP: auth 20/hr, poll creation 30/hr, responses 60/hr. `trust proxy` enabled for Railway.
- **Env var validation** — required vars checked at startup, exits with clear message if missing
- **ErrorBoundary** — React ErrorBoundary wraps entire app + extra wrapper around PollView. Shows fallback UI instead of white screen.
- **Unhandled rejection handler** — catches ATProto OAuth SDK's async TokenRefreshError to prevent crash loops

### Key gotchas

- **Session restore must happen after `app.listen()`** — the OAuth client fetches `client-metadata.json` from itself during restore. Starting restore before listening causes a deadlock.
- **Anonymous responses require creator's session** — if the creator's session expires or is lost, participants can't submit. Sessions persist to Railway volume to survive deploys.
- **Old polls use different field names** — `earliestTime`/`latestTime`/`slotDuration` vs `timeRange`/`slotMinutes`. PollView has fallback handling for both formats.
- **React render loops** — AvailGrid is sensitive to unstable object references in props. Never pass `new Set()` or `{}` inline as props. Use stable refs or module-level constants. The SchedulingGrid was created as a separate component (instead of adding props to AvailGrid) specifically to avoid this.
- **CabbageMeet-style mode separation in grid** — viewing mode shows heatmap only, editing mode shows my slots only. Never mix the two (causes visual double-counting).
- **`@atproto/lex` generated TypeScript** — server is plain JS, so generated TS in `server/src/lexicons/` is for type reference only. Server uses raw XRPC fetch calls.
- **Google Calendar** — queries all owner/writer calendars (not just primary). Skips holidays/birthdays by name. Filters out transparent (show as available) and declined events.

## Client architecture

### Pages
- `Landing.jsx` — hero (unauthenticated) or My Polls + PollCreator (authenticated)
- `PollView.jsx` — main poll page: grid + responses + scheduling
- `About.jsx` — Citizen Infra ecosystem info

### Key components
- `AvailGrid.jsx` — drag-to-paint availability grid. Rectangle selection, commit-on-pointerup, document-level listener. Heatmap from responses, hover tooltips, busy slots overlay.
- `SchedulingGrid.jsx` — separate grid for creator scheduling mode. Single-column vertical drag, teal preview. Completely independent from AvailGrid to avoid render loop issues.
- `PollCreator.jsx` — single-page poll creation form
- `ResponsePanel.jsx` — sidebar with participant list, bidirectional hover sync with grid

### Design system
- Warm off-white background: `#faf9f6`
- Teal accent: `#0d9488` (buttons, links, interactive elements)
- Text hierarchy: `#1a1a1a` (headings), `#6b6560` (body), `#a09a94` (muted)
- Borders: `#e8e5df`
- Font: Geist Variable (via @fontsource-variable/geist)
- shadcn/ui components in `client/src/components/ui/`

## Skills

Always use `frontend-design` skill for visual/UI tasks. Always query shadcn MCP before hand-rolling component CSS. When dispatching subagents for UI work, explicitly instruct them to use shadcn MCP tools.

## Deployment

Railway (single service, Nixpacks builder). Custom domain: avails.zhgnv.com.
- `railway.json` configures build command and start command
- `.node-version` = 22 (required for Vite 7 + Tailwind v4)
- Railway volume mounted at `/data` for session persistence
- `Procfile`: `web: cd server && node src/index.js`

### Environment variables
- `ATPROTO_CLIENT_ID` — URL to client-metadata.json endpoint
- `ATPROTO_REDIRECT_URI` — OAuth callback URL
- `ATPROTO_PRIVATE_KEY` — base64-encoded ES256 JWK (Railway mangles raw JSON)
- `SESSION_SECRET` — cookie signing
- `RESEND_API_KEY` — email service
- `CLIENT_URL` — deployed URL (for redirects and email links)
- `DATA_DIR` — Railway volume mount path (`/data`)
- `VITE_GOOGLE_CLIENT_ID` — optional, for Google Calendar overlay (baked into client build)

## Related Projects

- **my-community** (`../my-community/`) — has avails poll banners in participation feed (store/avails.js + AvailsBanner.jsx)
- **navidrome-jam** (`../navidrome-jam/`) — reference for Express + Railway + Resend + volume persistence patterns
- **community-admin** (`../community-admin/`) — parent ecosystem
