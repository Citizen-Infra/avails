# Avails MCP Endpoint — Design Spec

Date: 2026-04-05

## Goal

Add an embedded MCP endpoint to the Avails Express server so AI agents (Claude Code, etc.) can create scheduling polls, analyze responses, schedule meetings, and share poll links to connected Telegram groups. Multi-user — any ATProto user can authenticate.

## Approach

Embedded MCP endpoint in the existing Express server, following the Smoke Signal pattern. JSON-RPC over HTTP, not a separate service.

Reference implementation: [smokesignal.events/smokesignal](https://tangled.org/smokesignal.events/smokesignal) — `src/http/handle_mcp.rs`, `handle_mcp_oauth.rs`, `mcp_jwt.rs`, `handle_api_mcp_configuration.rs`.

## Transport

- Single `POST /mcp` endpoint on the existing Express server
- JSON-RPC protocol, MCP version `2025-03-26`
- `DELETE /mcp` for session termination (stateless with JWT, kept for protocol compliance)

## Authentication

ATProto OAuth flow adapted for MCP clients:

1. **`POST /mcp/register`** — Dynamic client registration. MCP client provides its metadata URL. Server stores client record (client_id, redirect_uri, DPoP key).

2. **`GET /mcp/authorize`** — Initiates ATProto OAuth. Server generates PKCE challenge, redirects user to their ATProto auth server. State parameter links back to MCP client.

3. **ATProto callback** — ATProto auth server redirects back to Avails. Server receives ATProto access token + refresh token.

4. **MCP callback** — Server wraps the ATProto access token in an HS256 JWT (with DID, client_id, mcp_client_id, expiry), redirects to MCP client with authorization code.

5. **`POST /mcp/token`** — MCP client exchanges authorization code for the JWT-wrapped token.

6. **Request auth** — MCP client sends `Authorization: Bearer <jwt>` on each request. Server unwraps JWT, verifies signature + expiry, resolves DID to PDS URL.

### Session persistence

The ATProto OAuth session (access token + refresh token) is stored to Railway volume (`/data`) alongside web UI sessions. This ensures:
- Polls created via MCP work for anonymous responses after MCP session ends
- Token refresh works the same as web UI sessions
- Sessions survive deploys and restarts

### Resource metadata

`GET /.well-known/oauth-protected-resource/mcp` — standard discovery endpoint for MCP OAuth.

## Tools

### Unauthenticated

#### `get_poll`

Get poll details, all responses, and overlap analysis.

**Input:**
- `did` (string, required) — Poll creator's DID
- `rkey` (string, required) — Poll record key

**Output:**
- Poll metadata (title, description, dates, timeRange, slotMinutes, timezone, community, status)
- Responses array (name, slots, createdAt)
- `bestSlots` array sorted by participant count descending:
  - `slot` (string) — datetime in creator's timezone (YYYY-MM-DDThh:mm)
  - `participants` (string[]) — names of available participants
  - `count` (number) — number of available participants

#### `list_polls`

List polls, optionally filtered by community and/or status.

**Input:**
- `community` (string, optional) — Community key (e.g., "scenius", "cibc")
- `status` (string, optional) — "open" or "closed"

**Output:**
- Array of poll summaries (did, rkey, title, community, status, responseCount, createdAt)

### Authenticated

#### `create_poll`

Create a new scheduling poll.

**Input:**
- `title` (string, required) — Poll title (max 200 chars)
- `description` (string, optional) — Poll description (max 1000 chars)
- `dates` (string[], required) — Array of dates in YYYY-MM-DD format
- `timeRange` (object, required) — `{ start: "HH:MM", end: "HH:MM" }`
- `slotMinutes` (number, required) — 15, 30, or 60
- `timezone` (string, required) — IANA timezone
- `community` (string, optional) — Community key for discovery
- `notifyAfter` (number, optional) — Response count threshold for notification
- `notifyEmail` (string, optional) — Email for notifications

**Output:**
- `uri` — AT URI of created poll
- `rkey` — Record key
- `did` — Creator's DID
- `url` — Web URL to the poll (e.g., `https://avails.zhgnv.com/p/{did}/{rkey}`)

#### `list_my_polls`

List the authenticated user's polls.

**Input:** (none)

**Output:**
- Array of poll summaries from the user's PDS

#### `schedule`

Set the chosen meeting time for a poll. Marks poll as closed, stores the final time, and triggers email notifications to participants who provided emails.

**Input:**
- `did` (string, required) — Poll creator's DID
- `rkey` (string, required) — Poll record key
- `finalTime` (string, required) — Chosen time in ISO 8601 format
- `finalDuration` (number, required) — Duration in minutes

**Output:**
- Confirmation with final time, duration, and notification status

#### `share_poll`

Post the poll link to the community's Telegram output channel.

**Input:**
- `did` (string, required) — Poll creator's DID
- `rkey` (string, required) — Poll record key
- `community` (string, required) — Community key (determines which Telegram channel)
- `message` (string, optional) — Custom message to include with the link

**Output:**
- Confirmation with channel name and message ID

**Implementation:** Uses Avails' own Telegram bot token (stored as `TELEGRAM_BOT_TOKEN` env var) and community→channel mapping from `groups.json` (already served at `GET /api/communities`). Posts a formatted message with poll title, dates, and link to `avails.zhgnv.com/p/{did}/{rkey}`. The bot must be added as an admin to each community's output channel.

## Server-side overlap analysis

The `get_poll` tool computes `bestSlots` on the server:

1. Collect all response slots
2. For each unique slot time, count which participants selected it
3. Sort descending by count
4. Return top slots (all slots with at least 1 participant)

This ensures consistent results regardless of client, avoids LLM timezone mistakes, and keeps payloads small.

## File structure

New files in `server/src/`:

```
server/src/
├── mcp/
│   ├── handler.js      — POST /mcp JSON-RPC dispatcher
│   ├── oauth.js        — MCP OAuth flow (register, authorize, token)
│   ├── jwt.js          — JWT wrap/unwrap for MCP tokens
│   ├── tools.js        — Tool implementations (create_poll, get_poll, etc.)
│   └── overlap.js      — Best slots computation
```

Routes registered in `server/src/index.js` alongside existing `/api` routes.

## Dependencies

- No new npm packages needed — `jsonwebtoken` or manual HS256 (crypto built-in), existing Express middleware
- Telegram posting uses `fetch` (built into Node 22) with the scenius-digest bot token
- MCP protocol compliance via manual JSON-RPC handling (no SDK dependency for the server side — keeps it lightweight like Smoke Signal)

## Environment variables (new)

- `MCP_JWT_SECRET` (optional) — JWT signing key for MCP tokens. Falls back to `SESSION_SECRET` if not set.
- `TELEGRAM_BOT_TOKEN` — Avails' own Telegram bot token for `share_poll`. Create via BotFather, add as admin to community output channels.

## Out of scope

- `submit_response` tool — availability submission is the web UI's job
- `edit_poll` / `delete_poll` — can be added later
- Response storage decoupling from creator's session — tracked in Citizen-Infra/avails#42
- MCP user configuration UI (Smoke Signal's `allow_dangerous` toggle) — not needed for v1
