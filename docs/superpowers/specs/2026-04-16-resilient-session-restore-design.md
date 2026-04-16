# Resilient Session Restore — avails#42

## Problem

When the avails server restarts (Railway redeploy), it tries to reconnect to Bluesky for each stored user session. If Bluesky is momentarily slow or unreachable, the session is permanently deleted. After that, anonymous poll responses return 503 ("poll creator needs to sign in") until the creator manually visits avails.zhgnv.com and logs in again.

## Root Cause

`restoreOAuthSessions()` in `sessionStore.js` deletes sessions when `client.restore(did)` fails (line 87-88). A transient network error permanently kills a valid session.

## Fix

### 1. Graceful restore failure (sessionStore.js)

When `client.restore(did)` fails during startup, keep the session data (did, handle, createdAt) but set `oauthSession: null`. Don't delete it. Log a warning.

### 2. Lazy restore on demand (responses.js)

`findOauthSessionByDid()` currently returns `null` when there's no live oauthSession. Change it to:
- If a session exists with the right DID but `oauthSession` is null, attempt `client.restore(did)` on the spot
- If restore succeeds, cache the live session and proceed
- If restore fails, return null (503 as before — but the session data is preserved for next attempt)

This means every poll visit is a retry opportunity. The creator never needs to manually sign in unless the refresh token itself has expired (180 days).

### 3. Fetch timeouts (polls.js)

All `fetch()` calls to PDS endpoints (plc.directory, bsky.social XRPC) currently have no timeout. Add `AbortController` with 10s timeout so requests fail fast instead of hanging forever.

Applies to:
- `resolvePds()` — plc.directory lookup
- Poll GET endpoint — PDS getRecord + listRecords
- Response POST — notification email's PDS fetch

### 4. Health check (railway.json)

Add `"healthcheckPath": "/api/health"` to the deploy config. Railway will validate the endpoint returns 200 before routing traffic to a new deployment.

## Files Changed

| File | Change |
|------|--------|
| `server/src/lib/sessionStore.js` | Don't delete sessions on restore failure; export getClient reference |
| `server/src/routes/responses.js` | Lazy restore in findOauthSessionByDid |
| `server/src/routes/polls.js` | Add fetch timeouts via AbortController |
| `railway.json` | Add healthcheckPath |

## Not in scope

- Server-managed ATProto identity (did:web) — future, more complex
- Database fallback for responses — future
- Client-side loading timeout/retry (tracked in avails#72, separate PR)
