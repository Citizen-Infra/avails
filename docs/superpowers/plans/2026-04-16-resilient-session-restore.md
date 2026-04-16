# Resilient Session Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep poll responses working through server restarts without requiring the creator to manually sign in again.

**Architecture:** Stop deleting sessions on transient restore failures. Add lazy on-demand restore so every poll visit retries. Add fetch timeouts so PDS calls fail fast instead of hanging forever.

**Tech Stack:** Node.js, Express, @atproto/oauth-client-node, Node built-in test runner

---

### Task 1: Graceful restore failure in sessionStore.js

**Files:**
- Modify: `server/src/lib/sessionStore.js:70-94`

- [ ] **Step 1: Change restoreOAuthSessions to keep sessions on failure**

Replace lines 85-88 in `restoreOAuthSessions()`:

```javascript
// BEFORE (deletes session on failure):
    } catch (err) {
      console.warn(`Failed to restore OAuth session for ${data.did}:`, err.message);
      sessions.delete(sessionId);
      markDirty('app-sessions');
    }

// AFTER (keeps session, marks oauthSession null):
    } catch (err) {
      console.warn(`Failed to restore OAuth session for ${data.did} (will retry on demand):`, err.message);
      data.oauthSession = null;
    }
```

- [ ] **Step 2: Add log summary for deferred sessions**

After the for loop in `restoreOAuthSessions()`, add a count of deferred sessions:

```javascript
  const deferred = [...sessions.values()].filter(d => d.did && !d.oauthSession).length;
  if (restored > 0) {
    console.log(`Restored ${restored} live OAuth sessions`);
  }
  if (deferred > 0) {
    console.log(`${deferred} sessions deferred — will restore on demand`);
  }
```

- [ ] **Step 3: Verify server starts successfully**

Run: `cd server && node --check src/lib/sessionStore.js`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /home/artem/claude/avails
git add server/src/lib/sessionStore.js
git commit -m "fix: don't delete sessions on transient restore failure (avails#42)"
```

---

### Task 2: Lazy restore on demand in responses.js

**Files:**
- Modify: `server/src/routes/responses.js:12-18`
- Modify: `server/src/routes/auth.js` (export getClient)

- [ ] **Step 1: Export getClient from auth.js**

The function already exists and is exported. Verify:

Run: `grep "export async function getClient" server/src/routes/auth.js`
Expected: Match found

- [ ] **Step 2: Replace findOauthSessionByDid with lazy restore version**

Replace lines 12-18 in `responses.js`:

```javascript
// BEFORE:
function findOauthSessionByDid(did) {
  for (const entry of sessions.values()) {
    if (entry.did === did) return entry.oauthSession;
  }
  return null;
}

// AFTER:
import { getClient } from './auth.js';

async function findOauthSessionByDid(did) {
  for (const entry of sessions.values()) {
    if (entry.did === did) {
      if (entry.oauthSession) return entry.oauthSession;
      // Session exists but oauthSession is null — try lazy restore
      try {
        const client = await getClient();
        const oauthSession = await client.restore(did);
        entry.oauthSession = oauthSession;
        console.log(`Lazy-restored OAuth session for ${did}`);
        return oauthSession;
      } catch (err) {
        console.warn(`Lazy restore failed for ${did}:`, err.message);
        return null;
      }
    }
  }
  return null;
}
```

- [ ] **Step 3: Update all callers to await findOauthSessionByDid**

The function is now async. Update three call sites:

Line ~53 (POST route):
```javascript
// BEFORE:
    const creatorSession = findOauthSessionByDid(did);
// AFTER:
    const creatorSession = await findOauthSessionByDid(did);
```

Line ~114 (PUT route):
```javascript
// BEFORE:
    const creatorSession = findOauthSessionByDid(did);
// AFTER:
    const creatorSession = await findOauthSessionByDid(did);
```

Line ~147 (DELETE route) — note this uses `findCreatorSession` which is a different name (likely a bug). Replace it:
```javascript
// BEFORE:
    const creatorSession = findCreatorSession(did);
// AFTER:
    const creatorSession = await findOauthSessionByDid(did);
```

- [ ] **Step 4: Verify syntax**

Run: `cd server && node --check src/routes/responses.js`
Expected: No errors

- [ ] **Step 5: Run existing tests**

Run: `cd server && npm test`
Expected: All tests pass (mocked sessions still work since the mock provides oauthSession directly)

- [ ] **Step 6: Commit**

```bash
cd /home/artem/claude/avails
git add server/src/routes/responses.js
git commit -m "fix: lazy-restore OAuth sessions on demand for response submission (avails#42)"
```

---

### Task 3: Fetch timeouts in polls.js and responses.js

**Files:**
- Modify: `server/src/routes/polls.js:15-23, 120-129`
- Modify: `server/src/routes/responses.js:21-29, 83-84`

- [ ] **Step 1: Add timeout helper**

Create a shared helper. Add to top of `server/src/routes/polls.js` (after imports):

```javascript
// Fetch with timeout — prevents hanging on slow PDS responses
function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}
```

- [ ] **Step 2: Replace fetch calls in polls.js resolvePds**

```javascript
// BEFORE (line 16):
  const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);

// AFTER:
  const res = await fetchWithTimeout(`https://plc.directory/${encodeURIComponent(did)}`);
```

- [ ] **Step 3: Replace fetch calls in polls.js GET /:did/:rkey**

```javascript
// BEFORE (line 121):
    const pollRes = await fetch(pollUrl);
// AFTER:
    const pollRes = await fetchWithTimeout(pollUrl);

// BEFORE (line 129):
    const responsesRes = await fetch(responsesUrl);
// AFTER:
    const responsesRes = await fetchWithTimeout(responsesUrl);
```

- [ ] **Step 4: Replace fetch calls in polls.js GET /my**

```javascript
// BEFORE (line 91):
    const listRes = await fetch(listUrl);
// AFTER:
    const listRes = await fetchWithTimeout(listUrl);
```

- [ ] **Step 5: Add same timeout helper to responses.js and update its resolvePds**

Add the same `fetchWithTimeout` helper at the top of `responses.js` and replace the fetch in its `resolvePds()`:

```javascript
function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}
```

In resolvePds (line 22):
```javascript
// BEFORE:
  const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
// AFTER:
  const res = await fetchWithTimeout(`https://plc.directory/${encodeURIComponent(did)}`);
```

In the notification email fetch (~line 84):
```javascript
// BEFORE:
      const pollRes = await fetch(pollUrl);
// AFTER:
      const pollRes = await fetchWithTimeout(pollUrl);
```

- [ ] **Step 6: Verify syntax on both files**

Run: `cd server && node --check src/routes/polls.js && node --check src/routes/responses.js`
Expected: No errors

- [ ] **Step 7: Run tests**

Run: `cd server && npm test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
cd /home/artem/claude/avails
git add server/src/routes/polls.js server/src/routes/responses.js
git commit -m "fix: add 10s fetch timeouts for PDS calls to prevent hanging (avails#42)"
```

---

### Task 4: Health check in railway.json

**Files:**
- Modify: `railway.json`

- [ ] **Step 1: Add healthcheckPath**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "cd client && npm install && npm run build && cd ../server && npm install",
    "watchPatterns": [
      "client/src/**",
      "client/package.json",
      "client/vite.config.js",
      "client/index.html",
      "server/src/**",
      "server/package.json",
      "lexicons/**"
    ]
  },
  "deploy": {
    "startCommand": "cd server && node src/index.js",
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/artem/claude/avails
git add railway.json
git commit -m "infra: add healthcheck path for Railway deployment validation (avails#42)"
```

---

### Task 5: Push and verify

- [ ] **Step 1: Run full test suite**

Run: `cd server && npm test`
Expected: All tests pass

- [ ] **Step 2: Push to GitHub**

```bash
cd /home/artem/claude/avails
git push
```

- [ ] **Step 3: Verify Railway auto-deploys and service is healthy**

Check deployment status via Railway API or dashboard. The health check at `/api/health` should return 200.
