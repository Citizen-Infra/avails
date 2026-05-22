# Avails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an ATProto-powered group scheduling tool (LettuceMeet alternative) with polls stored in creator's PDS, availability grid UI, email calendar invites, and MC/DN community integration.

**Architecture:** Express API server + React SPA (Vite + Tailwind + shadcn/ui). Custom ATProto lexicons define poll and response record types. Server uses `@atproto/lex` Client API to read/write records in creator's PDS. Anonymous participant responses written via creator's stored OAuth session. In-memory index for community discovery. Resend for .ics email on finalize.

**Tech Stack:** `@atproto/lex` (preview), `@atproto/oauth-client-node`, Express 4, React 19, Vite, Tailwind CSS, shadcn/ui, Resend, `ical-generator`, React Router

**Spec:** `docs/superpowers/specs/2026-04-02-avails-design.md`

**Reference repos:** navidrome-jam (Express + Vite patterns, Railway deploy, Resend email), my-community (shadcn MCP, community integration banners)

---

## File Structure

```
avails/
├── lexicons/
│   └── chat/avails/scheduling/
│       ├── poll.json              # Poll lexicon definition
│       └── response.json          # Response lexicon definition
├── server/
│   ├── src/
│   │   ├── index.js               # Express app, route mounting, static serving
│   │   ├── routes/
│   │   │   ├── auth.js            # ATProto OAuth login/callback/session/logout
│   │   │   ├── polls.js           # CRUD for polls, finalize endpoint
│   │   │   ├── responses.js       # Submit/edit availability responses
│   │   │   └── communities.js     # Proxy scenius-digest /api/groups
│   │   ├── lib/
│   │   │   ├── atproto.js         # PDS record operations (create/list/get poll+response)
│   │   │   ├── sessionStore.js    # In-memory encrypted OAuth session storage
│   │   │   ├── pollIndex.js       # In-memory poll index for community listing
│   │   │   ├── email.js           # Resend wrapper for .ics emails
│   │   │   └── ical.js            # .ics file generation
│   │   └── middleware/
│   │       └── auth.js            # requireAuth middleware (checks OAuth session)
│   ├── package.json
│   └── .env.example
├── client/
│   ├── src/
│   │   ├── main.jsx               # React entry point
│   │   ├── App.jsx                # React Router setup
│   │   ├── pages/
│   │   │   ├── Landing.jsx        # Poll creation page
│   │   │   ├── PollView.jsx       # Main poll page (grid + results)
│   │   │   └── AuthCallback.jsx   # OAuth redirect handler
│   │   ├── components/
│   │   │   ├── ui/                # shadcn components (installed via MCP)
│   │   │   ├── PollCreator.jsx    # Single-page creation form
│   │   │   ├── AvailGrid.jsx      # Drag-to-paint availability grid
│   │   │   ├── NameEntry.jsx      # Name input + optional ATProto + Google Calendar
│   │   │   ├── ResponsePanel.jsx  # Sidebar: participants, toggle visibility
│   │   │   ├── PollHeader.jsx     # Title, creator, share link, status
│   │   │   ├── FinalizeDialog.jsx # Creator picks time, sends invites
│   │   │   └── AuthButton.jsx     # "Sign in with Bluesky"
│   │   ├── lib/
│   │   │   ├── api.js             # Fetch wrapper for server API
│   │   │   └── googleCalendar.js  # Google Calendar OAuth + busy times
│   │   └── styles/
│   │       └── globals.css        # Tailwind base + custom CSS
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── components.json            # shadcn config
│   └── package.json
├── CLAUDE.md
├── README.md
├── Procfile                       # Railway: web: cd server && node src/index.js
└── .gitignore
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `avails/` directory and all config files
- Create: `avails/server/package.json`
- Create: `avails/client/package.json`
- Create: `avails/Procfile`
- Create: `avails/.gitignore`
- Create: `avails/CLAUDE.md`

- [ ] **Step 1: Create directory structure**

```bash
cd C:/Users/temaz/claude-project
mkdir -p avails/server/src/routes avails/server/src/lib avails/server/src/middleware
mkdir -p avails/client/src/pages avails/client/src/components/ui avails/client/src/lib avails/client/src/styles
mkdir -p avails/lexicons/chat/avails/scheduling
```

- [ ] **Step 2: Create server package.json**

Create `avails/server/package.json`:

```json
{
  "name": "avails-server",
  "version": "0.1.0",
  "description": "ATProto-powered group scheduling API server",
  "main": "src/index.js",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js"
  },
  "license": "AGPL-3.0",
  "dependencies": {
    "@atproto/lex": "^0.0.23",
    "@atproto/oauth-client-node": "^0.2.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.18.2",
    "express-rate-limit": "^8.2.1",
    "ical-generator": "^8.0.0",
    "resend": "^6.9.2"
  }
}
```

- [ ] **Step 3: Create client package.json**

Create `avails/client/package.json`:

```json
{
  "name": "avails-client",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router": "^7.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^5.1.1",
    "autoprefixer": "^10.4.21",
    "postcss": "^8.5.3",
    "tailwindcss": "^4.1.3",
    "vite": "^7.2.4"
  }
}
```

- [ ] **Step 4: Create Vite config**

Create `avails/client/vite.config.js`:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
  },
})
```

- [ ] **Step 5: Create Tailwind config**

Create `avails/client/tailwind.config.js`:

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

Create `avails/client/postcss.config.js`:

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

Create `avails/client/src/styles/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 6: Create HTML entry, React entry, and App shell**

Create `avails/client/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Avails — Group Scheduling</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

Create `avails/client/src/main.jsx`:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import './styles/globals.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
```

Create `avails/client/src/App.jsx`:

```jsx
import { Routes, Route } from 'react-router'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<div>Avails — coming soon</div>} />
    </Routes>
  )
}
```

- [ ] **Step 7: Create server entry point (minimal)**

Create `avails/server/src/index.js`:

```javascript
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// Serve static client build in production
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDist, 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Avails server listening on port ${PORT}`);
});
```

- [ ] **Step 8: Create remaining config files**

Create `avails/Procfile`:

```
web: cd server && node src/index.js
```

Create `avails/.gitignore`:

```
node_modules/
dist/
.env
*.log
src/lexicons/
```

Create `avails/server/.env.example`:

```bash
PORT=3000
CLIENT_URL=http://localhost:5173
ATPROTO_CLIENT_ID=https://avails.zhgnv.com/client-metadata.json
ATPROTO_REDIRECT_URI=https://avails.zhgnv.com/api/auth/callback
SESSION_SECRET=change-me-to-random-string
RESEND_API_KEY=re_xxxxxxxxxxxx
```

- [ ] **Step 9: Create CLAUDE.md**

Create `avails/CLAUDE.md`:

```markdown
# CLAUDE.md

## Project Overview

**Avails** — open-source ATProto-powered group scheduling tool (LettuceMeet alternative). Polls stored as records in creator's PDS via custom lexicons. Part of the Citizen Infrastructure ecosystem.

## Architecture

- **Server** (`server/`): Express 4, ES modules. ATProto OAuth + PDS record operations via `@atproto/lex`. Email via Resend.
- **Client** (`client/`): React 19 + Vite + Tailwind + shadcn/ui. Availability grid with drag-to-paint.
- **Lexicons** (`lexicons/`): Custom ATProto record types — `chat.avails.scheduling.poll` and `chat.avails.scheduling.response`.

## Skills

Always use `frontend-design` skill for visual/UI tasks. Always query shadcn MCP before hand-rolling component CSS.

## Commands

### Server
cd server && npm install && npm run dev    # Dev with hot-reload
cd server && npm start                      # Production

### Client
cd client && npm install && npm run dev    # Vite dev server (localhost:5173)
cd client && npm run build                 # Production build → dist/

## Deployment

Railway (single service): Express serves API + client static files.
Domain: avails.zhgnv.com

## Related Projects

- **my-community** (`../my-community/`) — consumes `/api/polls?community=X` for participation feed
- **navidrome-jam** (`../navidrome-jam/`) — reference for Express + Railway + Resend patterns
- **community-admin** (`../community-admin/`) — parent ecosystem
```

- [ ] **Step 10: Initialize git and install dependencies**

```bash
cd avails && git init
cd avails/server && npm install
cd avails/client && npm install
```

- [ ] **Step 11: Verify both dev servers start**

```bash
# Terminal 1
cd avails/server && npm run dev
# Should print: "Avails server listening on port 3000"

# Terminal 2
cd avails/client && npm run dev
# Should open Vite dev server, proxy /api to :3000
```

- [ ] **Step 12: Commit**

```bash
cd avails
git add -A
git commit -m "feat: project scaffolding — Express + React + Vite + Tailwind"
```

---

### Task 2: Lexicon definitions and codegen

**Files:**
- Create: `avails/lexicons/chat/avails/scheduling/poll.json`
- Create: `avails/lexicons/chat/avails/scheduling/response.json`

- [ ] **Step 1: Create poll lexicon**

Create `avails/lexicons/chat/avails/scheduling/poll.json`:

```json
{
  "lexicon": 1,
  "id": "chat.avails.scheduling.poll",
  "defs": {
    "main": {
      "type": "record",
      "description": "A scheduling poll with date/time options",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["title", "dates", "timeRange", "slotMinutes", "timezone", "status", "createdAt"],
        "properties": {
          "title": { "type": "string", "maxLength": 200 },
          "description": { "type": "string", "maxLength": 1000 },
          "dates": {
            "type": "array",
            "items": { "type": "string" },
            "minLength": 1,
            "maxLength": 31
          },
          "timeRange": { "type": "ref", "ref": "#timeRange" },
          "slotMinutes": { "type": "integer", "minimum": 15, "maximum": 120 },
          "timezone": { "type": "string", "maxLength": 100 },
          "community": { "type": "string", "maxLength": 100 },
          "status": { "type": "string", "knownValues": ["open", "closed"] },
          "finalTime": { "type": "string" },
          "finalDuration": { "type": "integer", "minimum": 15 },
          "notifyAfter": { "type": "integer", "minimum": 1 },
          "notifyVia": { "type": "string", "knownValues": ["email", "telegram"] },
          "notifyEmail": { "type": "string" },
          "notifyTelegram": { "type": "string" },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    },
    "timeRange": {
      "type": "object",
      "required": ["start", "end"],
      "properties": {
        "start": { "type": "string", "description": "HH:MM format" },
        "end": { "type": "string", "description": "HH:MM format" }
      }
    }
  }
}
```

- [ ] **Step 2: Create response lexicon**

Create `avails/lexicons/chat/avails/scheduling/response.json`:

```json
{
  "lexicon": 1,
  "id": "chat.avails.scheduling.response",
  "defs": {
    "main": {
      "type": "record",
      "description": "A participant's availability response to a poll",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["poll", "name", "slots", "createdAt"],
        "properties": {
          "poll": { "type": "string", "format": "at-uri" },
          "name": { "type": "string", "maxLength": 100 },
          "did": { "type": "string", "format": "did" },
          "email": { "type": "string", "maxLength": 200 },
          "slots": {
            "type": "array",
            "items": { "type": "string" },
            "description": "ISO datetime strings for start of each selected slot"
          },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Run lex build to generate TypeScript**

```bash
cd avails
npx @atproto/lex build --lexicons ./lexicons --out ./server/src/lexicons --indexFile
```

Expected: generates TypeScript files in `server/src/lexicons/` with type definitions, validators, and builders for `chat.avails.scheduling.poll` and `chat.avails.scheduling.response`.

- [ ] **Step 4: Verify generated types compile**

```bash
cd avails/server
# Check that the generated files import correctly
node -e "import('./src/lexicons/index.js').then(m => console.log(Object.keys(m)))"
```

- [ ] **Step 5: Commit**

```bash
cd avails
git add lexicons/ server/src/lexicons/
git commit -m "feat: define poll + response ATProto lexicons, generate TypeScript"
```

---

### Task 3: Server — ATProto OAuth authentication

**Files:**
- Create: `avails/server/src/lib/sessionStore.js`
- Create: `avails/server/src/routes/auth.js`
- Create: `avails/server/src/middleware/auth.js`
- Modify: `avails/server/src/index.js`

- [ ] **Step 1: Create session store**

Create `avails/server/src/lib/sessionStore.js`:

```javascript
import crypto from 'crypto';

const SECRET = process.env.SESSION_SECRET || 'dev-secret';

// In-memory store: sessionId → { oauthSession, did, handle, createdAt }
const sessions = new Map();

export function createSession(oauthSession, did, handle) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  sessions.set(sessionId, {
    oauthSession,
    did,
    handle,
    createdAt: Date.now(),
  });
  return sessionId;
}

export function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

export function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

export function getOAuthSession(sessionId) {
  const session = getSession(sessionId);
  return session?.oauthSession || null;
}
```

- [ ] **Step 2: Create auth routes**

Create `avails/server/src/routes/auth.js`:

```javascript
import { Router } from 'express';
import { OAuthClient } from '@atproto/oauth-client-node';
import { createSession, getSession, deleteSession } from '../lib/sessionStore.js';

const router = Router();

let oauthClient = null;

function getOAuthClient() {
  if (!oauthClient) {
    oauthClient = new OAuthClient({
      clientMetadata: {
        client_id: process.env.ATPROTO_CLIENT_ID,
        client_name: 'Avails',
        client_uri: process.env.CLIENT_URL || 'https://avails.zhgnv.com',
        redirect_uris: [process.env.ATPROTO_REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'atproto transition:generic',
        application_type: 'web',
        dpop_bound_access_tokens: true,
      },
      // State and session storage callbacks required by the SDK
      stateStore: {
        async set(key, state) { stateMap.set(key, state); },
        async get(key) { return stateMap.get(key); },
        async del(key) { stateMap.delete(key); },
      },
      sessionStore: {
        async set(sub, session) { oauthSessionMap.set(sub, session); },
        async get(sub) { return oauthSessionMap.get(sub); },
        async del(sub) { oauthSessionMap.delete(sub); },
      },
    });
  }
  return oauthClient;
}

// In-memory stores for OAuth flow state and sessions
const stateMap = new Map();
const oauthSessionMap = new Map();

// GET /api/auth/login?handle=user.bsky.social
router.get('/login', async (req, res) => {
  try {
    const handle = req.query.handle;
    if (!handle) return res.status(400).json({ error: 'handle required' });

    const client = getOAuthClient();
    const url = await client.authorize(handle, { scope: 'atproto transition:generic' });
    res.redirect(url.toString());
  } catch (err) {
    console.error('OAuth login error:', err);
    res.status(500).json({ error: 'OAuth login failed' });
  }
});

// GET /api/auth/callback
router.get('/callback', async (req, res) => {
  try {
    const client = getOAuthClient();
    const params = new URLSearchParams(req.url.split('?')[1]);
    const { session } = await client.callback(params);

    const did = session.did;
    const sessionId = createSession(session, did, did); // handle resolved later

    // Set cookie and redirect to app
    res.cookie('avails_session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/?error=auth_failed');
  }
});

// GET /api/auth/session
router.get('/session', (req, res) => {
  const sessionId = req.cookies?.avails_session;
  if (!sessionId) return res.json({ authenticated: false });

  const session = getSession(sessionId);
  if (!session) return res.json({ authenticated: false });

  res.json({
    authenticated: true,
    did: session.did,
    handle: session.handle,
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const sessionId = req.cookies?.avails_session;
  if (sessionId) deleteSession(sessionId);
  res.clearCookie('avails_session');
  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 3: Create auth middleware**

Create `avails/server/src/middleware/auth.js`:

```javascript
import { getSession, getOAuthSession } from '../lib/sessionStore.js';

export function requireAuth(req, res, next) {
  const sessionId = req.cookies?.avails_session;
  if (!sessionId) return res.status(401).json({ error: 'Not authenticated' });

  const session = getSession(sessionId);
  if (!session) return res.status(401).json({ error: 'Session expired' });

  req.userDid = session.did;
  req.userHandle = session.handle;
  req.oauthSession = session.oauthSession;
  next();
}
```

- [ ] **Step 4: Mount auth routes in server**

Modify `avails/server/src/index.js` — add cookie-parser and auth routes:

Add to dependencies in package.json: `"cookie-parser": "^1.4.7"`

Update `avails/server/src/index.js`:

```javascript
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve static client build in production
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDist, 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Avails server listening on port ${PORT}`);
});
```

- [ ] **Step 5: Install cookie-parser and verify server starts**

```bash
cd avails/server && npm install cookie-parser
cd avails/server && npm run dev
# Should start without errors
```

- [ ] **Step 6: Commit**

```bash
cd avails
git add server/
git commit -m "feat: ATProto OAuth auth routes + session store + auth middleware"
```

---

### Task 4: Server — Poll CRUD + poll index

**Files:**
- Create: `avails/server/src/lib/atproto.js`
- Create: `avails/server/src/lib/pollIndex.js`
- Create: `avails/server/src/routes/polls.js`
- Modify: `avails/server/src/index.js`

- [ ] **Step 1: Create PDS record operations helper**

Create `avails/server/src/lib/atproto.js`:

```javascript
import { Client } from '@atproto/lex';

/**
 * Create an authenticated Client for PDS record operations.
 * @param {object} oauthSession - The OAuth session from sessionStore
 */
export function createClient(oauthSession) {
  return new Client(oauthSession);
}

/**
 * Create a record in the user's repo.
 */
export async function createRecord(oauthSession, collection, record) {
  const client = createClient(oauthSession);
  return client.create(collection, record);
}

/**
 * List records in a collection from any user's repo.
 * Uses an unauthenticated client since listRecords is public.
 */
export async function listRecords(pdsUrl, did, collection, limit = 100) {
  const client = new Client(pdsUrl);
  return client.list(collection, { repo: did, limit });
}

/**
 * Get a single record.
 */
export async function getRecord(pdsUrl, did, collection, rkey) {
  const client = new Client(pdsUrl);
  return client.get(collection, { repo: did, rkey });
}

/**
 * Update a record.
 */
export async function putRecord(oauthSession, collection, rkey, record) {
  const client = createClient(oauthSession);
  return client.put(collection, record, { rkey });
}

/**
 * Delete a record.
 */
export async function deleteRecord(oauthSession, collection, rkey) {
  const client = createClient(oauthSession);
  return client.delete(collection, { rkey });
}
```

- [ ] **Step 2: Create poll index**

Create `avails/server/src/lib/pollIndex.js`:

```javascript
// In-memory index for community-based poll discovery.
// Rebuilt from PDS reads on server restart.
// Updated on poll creation and response submission.

const polls = new Map(); // key: `${did}/${rkey}` → { did, rkey, title, community, status, responseCount, createdAt }

export function indexPoll(did, rkey, poll) {
  const key = `${did}/${rkey}`;
  polls.set(key, {
    did,
    rkey,
    title: poll.title,
    community: poll.community || null,
    status: poll.status,
    responseCount: 0,
    createdAt: poll.createdAt,
  });
}

export function updatePollStatus(did, rkey, status) {
  const key = `${did}/${rkey}`;
  const entry = polls.get(key);
  if (entry) entry.status = status;
}

export function incrementResponseCount(did, rkey) {
  const key = `${did}/${rkey}`;
  const entry = polls.get(key);
  if (entry) entry.responseCount++;
  return entry?.responseCount || 0;
}

export function removePoll(did, rkey) {
  polls.delete(`${did}/${rkey}`);
}

export function listByCommunity(community, status = 'open') {
  const results = [];
  for (const entry of polls.values()) {
    if (entry.community === community && entry.status === status) {
      results.push(entry);
    }
  }
  return results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
```

- [ ] **Step 3: Create poll routes**

Create `avails/server/src/routes/polls.js`:

```javascript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createRecord, putRecord, deleteRecord } from '../lib/atproto.js';
import { indexPoll, updatePollStatus, removePoll, listByCommunity } from '../lib/pollIndex.js';

const router = Router();

const POLL_COLLECTION = 'chat.avails.scheduling.poll';
const RESPONSE_COLLECTION = 'chat.avails.scheduling.response';

// POST /api/polls — create a new poll
router.post('/', requireAuth, async (req, res) => {
  try {
    const { title, description, dates, timeRange, slotMinutes, timezone, community, notifyAfter, notifyVia, notifyEmail } = req.body;

    if (!title || !dates?.length || !timeRange || !slotMinutes || !timezone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const record = {
      title,
      description: description || undefined,
      dates,
      timeRange,
      slotMinutes,
      timezone,
      community: community || undefined,
      status: 'open',
      notifyAfter: notifyAfter || undefined,
      notifyVia: notifyVia || undefined,
      notifyEmail: notifyEmail || undefined,
      createdAt: new Date().toISOString(),
    };

    const result = await createRecord(req.oauthSession, POLL_COLLECTION, record);
    const rkey = result.uri.split('/').pop();

    indexPoll(req.userDid, rkey, record);

    res.json({
      uri: result.uri,
      did: req.userDid,
      rkey,
      url: `/p/${req.userDid}/${rkey}`,
    });
  } catch (err) {
    console.error('Create poll error:', err);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// GET /api/polls?community=X&status=open — list polls for a community
router.get('/', (req, res) => {
  const { community, status } = req.query;
  if (!community) return res.status(400).json({ error: 'community required' });
  const results = listByCommunity(community, status || 'open');
  res.json(results);
});

// GET /api/polls/:did/:rkey — get poll + responses
router.get('/:did/:rkey', async (req, res) => {
  try {
    const { did, rkey } = req.params;

    // Read poll and responses from PDS
    // For now, use the AT Protocol public API
    const pdsUrl = 'https://bsky.social'; // TODO: resolve DID to PDS URL
    
    // Use com.atproto.repo.getRecord and com.atproto.repo.listRecords via XRPC
    const pollResponse = await fetch(
      `https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=${POLL_COLLECTION}&rkey=${rkey}`
    );
    if (!pollResponse.ok) return res.status(404).json({ error: 'Poll not found' });
    const pollData = await pollResponse.json();

    // List all responses for this poll
    const responsesResponse = await fetch(
      `https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=${RESPONSE_COLLECTION}&limit=100`
    );
    const responsesData = await responsesResponse.json();

    // Filter responses that reference this poll
    const pollUri = `at://${did}/${POLL_COLLECTION}/${rkey}`;
    const responses = (responsesData.records || [])
      .filter(r => r.value.poll === pollUri)
      .map(r => ({
        rkey: r.uri.split('/').pop(),
        ...r.value,
      }));

    res.json({
      poll: pollData.value,
      did,
      rkey,
      responses,
    });
  } catch (err) {
    console.error('Get poll error:', err);
    res.status(500).json({ error: 'Failed to get poll' });
  }
});

// PUT /api/polls/:did/:rkey/finalize — pick a time
router.put('/:did/:rkey/finalize', requireAuth, async (req, res) => {
  try {
    const { did, rkey } = req.params;
    const { finalTime, finalDuration } = req.body;

    if (did !== req.userDid) {
      return res.status(403).json({ error: 'Only poll creator can finalize' });
    }

    if (!finalTime || !finalDuration) {
      return res.status(400).json({ error: 'finalTime and finalDuration required' });
    }

    // Get current poll record
    const pollResponse = await fetch(
      `https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=${POLL_COLLECTION}&rkey=${rkey}`
    );
    const pollData = await pollResponse.json();

    // Update with finalTime
    const updatedRecord = {
      ...pollData.value,
      finalTime,
      finalDuration,
      status: 'closed',
    };

    await putRecord(req.oauthSession, POLL_COLLECTION, rkey, updatedRecord);
    updatePollStatus(did, rkey, 'closed');

    // TODO: Task 6 will add .ics email sending here

    res.json({ ok: true, finalTime, finalDuration });
  } catch (err) {
    console.error('Finalize poll error:', err);
    res.status(500).json({ error: 'Failed to finalize poll' });
  }
});

// DELETE /api/polls/:did/:rkey
router.delete('/:did/:rkey', requireAuth, async (req, res) => {
  try {
    const { did, rkey } = req.params;
    if (did !== req.userDid) {
      return res.status(403).json({ error: 'Only poll creator can delete' });
    }

    await deleteRecord(req.oauthSession, POLL_COLLECTION, rkey);
    removePoll(did, rkey);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete poll error:', err);
    res.status(500).json({ error: 'Failed to delete poll' });
  }
});

export default router;
```

- [ ] **Step 4: Mount poll routes**

Add to `avails/server/src/index.js` after auth routes:

```javascript
import pollRoutes from './routes/polls.js';
// ... after app.use('/api/auth', authRoutes);
app.use('/api/polls', pollRoutes);
```

- [ ] **Step 5: Verify server starts with new routes**

```bash
cd avails/server && npm run dev
curl http://localhost:3000/api/health
# Should return: {"status":"ok"}
```

- [ ] **Step 6: Commit**

```bash
cd avails
git add server/
git commit -m "feat: poll CRUD routes + PDS record helpers + community poll index"
```

---

### Task 5: Server — Response submission + creator notifications

**Files:**
- Create: `avails/server/src/routes/responses.js`
- Create: `avails/server/src/lib/email.js`
- Modify: `avails/server/src/index.js`

- [ ] **Step 1: Create email helper**

Create `avails/server/src/lib/email.js`:

```javascript
import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export async function sendEmail({ to, subject, html, attachments }) {
  if (!resend) {
    console.warn('RESEND_API_KEY not set, skipping email to:', to);
    return;
  }

  const result = await resend.emails.send({
    from: 'Avails <noreply@zhgnv.com>',
    to,
    subject,
    html,
    attachments,
  });

  return result;
}
```

- [ ] **Step 2: Create response routes**

Create `avails/server/src/routes/responses.js`:

```javascript
import { Router } from 'express';
import { getSession, getOAuthSession } from '../lib/sessionStore.js';
import { incrementResponseCount } from '../lib/pollIndex.js';
import { sendEmail } from '../lib/email.js';

const router = Router();

const RESPONSE_COLLECTION = 'chat.avails.scheduling.response';
const POLL_COLLECTION = 'chat.avails.scheduling.poll';

// POST /api/polls/:did/:rkey/responses — submit availability
router.post('/:did/:rkey/responses', async (req, res) => {
  try {
    const { did, rkey } = req.params;
    const { name, email, slots, participantDid } = req.body;

    if (!name || !slots?.length) {
      return res.status(400).json({ error: 'name and slots required' });
    }

    const pollUri = `at://${did}/${POLL_COLLECTION}/${rkey}`;

    const record = {
      poll: pollUri,
      name,
      did: participantDid || undefined,
      email: email || undefined,
      slots,
      createdAt: new Date().toISOString(),
    };

    // Find the creator's OAuth session to write on their behalf
    // We need to find the session for the poll creator's DID
    // This is stored when the creator logged in and created the poll
    const creatorSession = findCreatorSession(did);

    if (!creatorSession) {
      return res.status(503).json({ error: 'Poll creator session expired. Creator needs to re-authenticate.' });
    }

    // Write response to creator's PDS
    const { Client } = await import('@atproto/lex');
    const client = new Client(creatorSession);
    const result = await client.create(RESPONSE_COLLECTION, record);

    const responseCount = incrementResponseCount(did, rkey);

    // Check if creator should be notified
    await checkCreatorNotification(did, rkey, responseCount);

    res.json({
      uri: result.uri,
      rkey: result.uri.split('/').pop(),
    });
  } catch (err) {
    console.error('Submit response error:', err);
    res.status(500).json({ error: 'Failed to submit response' });
  }
});

/**
 * Find the creator's OAuth session from the session store.
 * Scans all sessions for one matching the given DID.
 */
function findCreatorSession(did) {
  // Import getSession store internals - this is a known coupling
  // In production, we'd have a dedicated creator session store
  // For now, we scan all sessions
  const { sessions } = await import('../lib/sessionStore.js');
  for (const [, session] of sessions) {
    if (session.did === did) return session.oauthSession;
  }
  return null;
}

/**
 * Check threshold and notify creator if enough responses.
 */
async function checkCreatorNotification(creatorDid, rkey, responseCount) {
  try {
    // Fetch the poll to check notifyAfter
    const pollResponse = await fetch(
      `https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=${creatorDid}&collection=${POLL_COLLECTION}&rkey=${rkey}`
    );
    const pollData = await pollResponse.json();
    const poll = pollData.value;

    if (!poll.notifyAfter || responseCount !== poll.notifyAfter) return;

    if (poll.notifyVia === 'email' && poll.notifyEmail) {
      const pollUrl = `${process.env.CLIENT_URL || 'https://avails.zhgnv.com'}/p/${creatorDid}/${rkey}`;
      await sendEmail({
        to: poll.notifyEmail,
        subject: `${responseCount} people responded to "${poll.title}"`,
        html: `
          <p>${responseCount} people have filled in their availability for <strong>${poll.title}</strong>.</p>
          <p><a href="${pollUrl}">Pick a time →</a></p>
        `,
      });
    }
  } catch (err) {
    console.error('Creator notification error:', err);
  }
}

export default router;
```

- [ ] **Step 3: Fix findCreatorSession — export sessions Map**

Update `avails/server/src/lib/sessionStore.js` — add export for the sessions Map:

```javascript
// Add to the top-level exports
export const sessions = new Map();
```

And update all functions to use this exported Map (they already do, but make sure it's the same reference).

- [ ] **Step 4: Fix findCreatorSession to not use top-level await import**

Replace the `findCreatorSession` function in `responses.js`:

```javascript
import { sessions } from '../lib/sessionStore.js';

function findCreatorSession(did) {
  for (const [, session] of sessions) {
    if (session.did === did) return session.oauthSession;
  }
  return null;
}
```

Remove the `await import` from the function body.

- [ ] **Step 5: Mount response routes**

Add to `avails/server/src/index.js`:

```javascript
import responseRoutes from './routes/responses.js';
// ... after poll routes
app.use('/api/polls', responseRoutes);
```

- [ ] **Step 6: Verify server starts**

```bash
cd avails/server && npm run dev
```

- [ ] **Step 7: Commit**

```bash
cd avails
git add server/
git commit -m "feat: response submission + creator threshold notifications via email"
```

---

### Task 6: Server — .ics calendar invite on finalize

**Files:**
- Create: `avails/server/src/lib/ical.js`
- Modify: `avails/server/src/routes/polls.js` (finalize endpoint)

- [ ] **Step 1: Create .ics generator**

Create `avails/server/src/lib/ical.js`:

```javascript
import ical from 'ical-generator';

/**
 * Generate an .ics calendar file for a finalized poll.
 * @param {object} poll - The poll record
 * @param {string} pollUrl - URL to the poll
 * @returns {string} .ics file content
 */
export function generateIcs(poll, pollUrl) {
  const calendar = ical({ name: 'Avails' });

  const start = new Date(poll.finalTime);
  const end = new Date(start.getTime() + poll.finalDuration * 60 * 1000);

  calendar.createEvent({
    start,
    end,
    summary: poll.title,
    description: poll.description
      ? `${poll.description}\n\nScheduled via Avails: ${pollUrl}`
      : `Scheduled via Avails: ${pollUrl}`,
    url: pollUrl,
    timezone: poll.timezone,
  });

  return calendar.toString();
}
```

- [ ] **Step 2: Add .ics sending to finalize endpoint**

In `avails/server/src/routes/polls.js`, replace the `// TODO: Task 6` comment in the finalize handler:

```javascript
import { generateIcs } from '../lib/ical.js';
import { sendEmail } from '../lib/email.js';

// Inside the finalize handler, after updatePollStatus:

    // Send .ics to all participants who left an email
    const pollUrl = `${process.env.CLIENT_URL || 'https://avails.zhgnv.com'}/p/${did}/${rkey}`;
    const responsesResponse = await fetch(
      `https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=${RESPONSE_COLLECTION}&limit=100`
    );
    const responsesData = await responsesResponse.json();
    const pollUri = `at://${did}/${POLL_COLLECTION}/${rkey}`;
    const responses = (responsesData.records || []).filter(r => r.value.poll === pollUri);

    const icsContent = generateIcs(updatedRecord, pollUrl);
    const emailsToNotify = responses
      .map(r => r.value.email)
      .filter(Boolean);

    for (const email of emailsToNotify) {
      await sendEmail({
        to: email,
        subject: `Meeting scheduled: ${updatedRecord.title}`,
        html: `
          <p>A time has been picked for <strong>${updatedRecord.title}</strong>.</p>
          <p><strong>When:</strong> ${new Date(finalTime).toLocaleString('en-US', { 
            dateStyle: 'full', 
            timeStyle: 'short',
            timeZone: updatedRecord.timezone 
          })}</p>
          <p><strong>Duration:</strong> ${finalDuration} minutes</p>
          <p>A calendar invite is attached. <a href="${pollUrl}">View poll →</a></p>
        `,
        attachments: [{
          filename: 'invite.ics',
          content: Buffer.from(icsContent),
          contentType: 'text/calendar',
        }],
      });
    }
```

- [ ] **Step 3: Install ical-generator if not already**

```bash
cd avails/server && npm install ical-generator
```

- [ ] **Step 4: Verify server starts**

```bash
cd avails/server && npm run dev
```

- [ ] **Step 5: Commit**

```bash
cd avails
git add server/
git commit -m "feat: .ics calendar invite emails on poll finalization"
```

---

### Task 7: Server — Communities proxy

**Files:**
- Create: `avails/server/src/routes/communities.js`
- Modify: `avails/server/src/index.js`

- [ ] **Step 1: Create communities route**

Create `avails/server/src/routes/communities.js`:

```javascript
import { Router } from 'express';

const router = Router();

const SCENIUS_DIGEST_API = 'https://scenius-digest.vercel.app/api/groups';

// GET /api/communities — proxy scenius-digest groups
router.get('/', async (req, res) => {
  try {
    const response = await fetch(SCENIUS_DIGEST_API);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Communities fetch error:', err);
    res.status(502).json({ error: 'Failed to fetch communities' });
  }
});

export default router;
```

- [ ] **Step 2: Mount in server**

Add to `avails/server/src/index.js`:

```javascript
import communityRoutes from './routes/communities.js';
app.use('/api/communities', communityRoutes);
```

- [ ] **Step 3: Commit**

```bash
cd avails
git add server/
git commit -m "feat: communities proxy route for scenius-digest groups"
```

---

### Task 8: Client — shadcn setup + Landing page with PollCreator

**Files:**
- Modify: `avails/client/` (shadcn setup)
- Create: `avails/client/src/lib/api.js`
- Create: `avails/client/src/components/AuthButton.jsx`
- Create: `avails/client/src/components/PollCreator.jsx`
- Create: `avails/client/src/pages/Landing.jsx`
- Modify: `avails/client/src/App.jsx`

- [ ] **Step 1: Set up shadcn/ui**

Query shadcn MCP for project setup instructions. Install required shadcn components: `button`, `input`, `textarea`, `select`, `calendar`, `popover`, `dialog`, `tooltip`, `card`, `badge`, `separator`, `label`.

Follow the shadcn MCP instructions for Vite + React + Tailwind setup.

- [ ] **Step 2: Create API helper**

Create `avails/client/src/lib/api.js`:

```javascript
const API_BASE = '';

export async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Request failed');
  }

  return res.json();
}

export async function getSession() {
  return apiFetch('/api/auth/session');
}

export async function createPoll(data) {
  return apiFetch('/api/polls', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getPoll(did, rkey) {
  return apiFetch(`/api/polls/${did}/${rkey}`);
}

export async function submitResponse(did, rkey, data) {
  return apiFetch(`/api/polls/${did}/${rkey}/responses`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function finalizePoll(did, rkey, finalTime, finalDuration) {
  return apiFetch(`/api/polls/${did}/${rkey}/finalize`, {
    method: 'PUT',
    body: JSON.stringify({ finalTime, finalDuration }),
  });
}

export async function getCommunities() {
  return apiFetch('/api/communities');
}
```

- [ ] **Step 3: Create AuthButton component**

Create `avails/client/src/components/AuthButton.jsx`:

```jsx
import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'

export default function AuthButton({ session, onLogin }) {
  const [handle, setHandle] = useState('')
  const [showInput, setShowInput] = useState(false)

  if (session?.authenticated) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Signed in as</span>
        <span className="font-medium">{session.handle}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
            onLogin(null)
          }}
        >
          Sign out
        </Button>
      </div>
    )
  }

  if (!showInput) {
    return (
      <Button variant="outline" onClick={() => setShowInput(true)}>
        Sign in with Bluesky
      </Button>
    )
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (handle) window.location.href = `/api/auth/login?handle=${encodeURIComponent(handle)}`
      }}
    >
      <Input
        placeholder="your.handle.bsky.social"
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        className="w-64"
      />
      <Button type="submit" disabled={!handle}>
        Sign in
      </Button>
    </form>
  )
}
```

- [ ] **Step 4: Create PollCreator component**

Create `avails/client/src/components/PollCreator.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { Calendar } from './ui/calendar'
import { createPoll, getCommunities } from '../lib/api'

export default function PollCreator() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedDates, setSelectedDates] = useState([])
  const [timeStart, setTimeStart] = useState('09:00')
  const [timeEnd, setTimeEnd] = useState('17:00')
  const [slotMinutes, setSlotMinutes] = useState(30)
  const [community, setCommunity] = useState('')
  const [communities, setCommunities] = useState([])
  const [notifyAfter, setNotifyAfter] = useState('')
  const [notifyEmail, setNotifyEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    getCommunities()
      .then(setCommunities)
      .catch(() => {})
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title || !selectedDates.length) return

    setSubmitting(true)
    setError(null)

    try {
      const dates = selectedDates.map(d => d.toISOString().split('T')[0]).sort()
      const result = await createPoll({
        title,
        description: description || undefined,
        dates,
        timeRange: { start: timeStart, end: timeEnd },
        slotMinutes,
        timezone,
        community: community || undefined,
        notifyAfter: notifyAfter ? parseInt(notifyAfter) : undefined,
        notifyVia: notifyEmail ? 'email' : undefined,
        notifyEmail: notifyEmail || undefined,
      })
      navigate(result.url)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <div className="space-y-2">
        <Label htmlFor="title">What's this meeting about?</Label>
        <Input
          id="title"
          placeholder="Team standup"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          placeholder="Finding a weekly slot that works for everyone"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label>What days might work?</Label>
        <Calendar
          mode="multiple"
          selected={selectedDates}
          onSelect={setSelectedDates}
          className="rounded-md border"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Earliest</Label>
          <Input type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Latest</Label>
          <Input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Slot</Label>
          <select
            className="flex h-10 w-full rounded-md border px-3 py-2 text-sm"
            value={slotMinutes}
            onChange={(e) => setSlotMinutes(parseInt(e.target.value))}
          >
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>1 hour</option>
          </select>
        </div>
      </div>

      {communities.length > 0 && (
        <div className="space-y-2">
          <Label>Community (optional)</Label>
          <select
            className="flex h-10 w-full rounded-md border px-3 py-2 text-sm"
            value={community}
            onChange={(e) => setCommunity(e.target.value)}
          >
            <option value="">None</option>
            {communities.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Notify me after (# responses)</Label>
          <Input
            type="number"
            min="1"
            placeholder="e.g. 5"
            value={notifyAfter}
            onChange={(e) => setNotifyAfter(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Notification email</Label>
          <Input
            type="email"
            placeholder="you@example.com"
            value={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.value)}
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Timezone: {timezone}
      </p>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button type="submit" disabled={submitting || !title || !selectedDates.length} size="lg">
        {submitting ? 'Creating...' : 'Create poll'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 5: Create Landing page**

Create `avails/client/src/pages/Landing.jsx`:

```jsx
import { useState, useEffect } from 'react'
import AuthButton from '../components/AuthButton'
import PollCreator from '../components/PollCreator'
import { getSession } from '../lib/api'

export default function Landing() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSession()
      .then(setSession)
      .catch(() => setSession({ authenticated: false }))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">avails</h1>
        <AuthButton session={session} onLogin={setSession} />
      </header>

      <main className="px-6 py-8 max-w-3xl mx-auto">
        {session?.authenticated ? (
          <>
            <h2 className="text-2xl font-semibold mb-6">Create a scheduling poll</h2>
            <PollCreator />
          </>
        ) : (
          <div className="text-center py-16 space-y-4">
            <h2 className="text-3xl font-semibold">Find a time that works for everyone</h2>
            <p className="text-muted-foreground text-lg">
              ATProto-powered group scheduling. Your polls, your data.
            </p>
            <p className="text-muted-foreground">
              Sign in with Bluesky to create a poll. No account needed to respond.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 6: Update App.jsx with routes**

Update `avails/client/src/App.jsx`:

```jsx
import { Routes, Route } from 'react-router'
import Landing from './pages/Landing'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/p/:did/:rkey" element={<div>Poll view — coming in Task 9</div>} />
      <Route path="/auth/callback" element={<div>Auth callback — handled server-side</div>} />
    </Routes>
  )
}
```

- [ ] **Step 7: Verify client builds and runs**

```bash
cd avails/client && npm run dev
# Open http://localhost:5173 — should show landing page
```

- [ ] **Step 8: Commit**

```bash
cd avails
git add client/
git commit -m "feat: Landing page with PollCreator, AuthButton, shadcn components"
```

---

### Task 9: Client — AvailGrid component

**Files:**
- Create: `avails/client/src/components/AvailGrid.jsx`

This is the core component. Days as columns, time slots as rows. Click-and-drag to paint.

- [ ] **Step 1: Create AvailGrid**

Create `avails/client/src/components/AvailGrid.jsx`:

```jsx
import { useState, useRef, useCallback, useMemo } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

/**
 * Generate time slot labels between start and end time.
 * @param {string} start - "HH:MM"
 * @param {string} end - "HH:MM"
 * @param {number} slotMinutes
 * @returns {string[]} Array of "HH:MM" strings
 */
function generateSlots(start, end, slotMinutes) {
  const slots = []
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let current = sh * 60 + sm
  const endMin = eh * 60 + em

  while (current < endMin) {
    const h = Math.floor(current / 60)
    const m = current % 60
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    current += slotMinutes
  }
  return slots
}

/**
 * Build a slot key: "2026-04-07T09:00"
 */
function slotKey(date, time) {
  return `${date}T${time}`
}

/**
 * Compute heatmap data from all responses.
 * @returns {Map<string, string[]>} slotKey → array of participant names
 */
function computeHeatmap(responses) {
  const map = new Map()
  for (const r of responses) {
    for (const slot of r.slots) {
      const names = map.get(slot) || []
      names.push(r.name)
      map.set(slot, names)
    }
  }
  return map
}

export default function AvailGrid({
  dates,
  timeRange,
  slotMinutes,
  responses = [],
  mySlots = new Set(),
  onSlotsChange,
  readOnly = false,
  highlightName = null,
  busySlots = new Set(),
}) {
  const timeSlots = useMemo(
    () => generateSlots(timeRange.start, timeRange.end, slotMinutes),
    [timeRange, slotMinutes]
  )
  const heatmap = useMemo(() => computeHeatmap(responses), [responses])
  const maxParticipants = responses.length || 1

  const [isDragging, setIsDragging] = useState(false)
  const [dragMode, setDragMode] = useState(null) // 'add' or 'remove'
  const gridRef = useRef(null)

  const handlePointerDown = useCallback((key) => {
    if (readOnly) return
    const adding = !mySlots.has(key)
    setIsDragging(true)
    setDragMode(adding ? 'add' : 'remove')

    const next = new Set(mySlots)
    if (adding) next.add(key)
    else next.delete(key)
    onSlotsChange(next)
  }, [readOnly, mySlots, onSlotsChange])

  const handlePointerEnter = useCallback((key) => {
    if (!isDragging || readOnly) return
    const next = new Set(mySlots)
    if (dragMode === 'add') next.add(key)
    else next.delete(key)
    onSlotsChange(next)
  }, [isDragging, dragMode, readOnly, mySlots, onSlotsChange])

  const handlePointerUp = useCallback(() => {
    setIsDragging(false)
    setDragMode(null)
  }, [])

  // Format day header
  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return {
      day: d.toLocaleDateString('en-US', { weekday: 'short' }),
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }
  }

  // Heatmap color intensity
  const heatColor = (count) => {
    if (count === 0) return ''
    const ratio = count / maxParticipants
    const lightness = 90 - ratio * 50 // 90% (lightest) to 40% (darkest)
    return `hsl(142, 60%, ${lightness}%)`
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div
        ref={gridRef}
        className="select-none overflow-x-auto"
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div className="inline-grid" style={{
          gridTemplateColumns: `80px repeat(${dates.length}, minmax(80px, 1fr))`,
        }}>
          {/* Header row */}
          <div className="p-2" /> {/* Empty corner */}
          {dates.map((date) => {
            const { day, date: dateStr } = formatDate(date)
            return (
              <div key={date} className="p-2 text-center text-sm font-medium">
                <div>{day}</div>
                <div className="text-muted-foreground text-xs">{dateStr}</div>
              </div>
            )
          })}

          {/* Time rows */}
          {timeSlots.map((time) => (
            <>
              <div key={`label-${time}`} className="p-2 text-xs text-muted-foreground text-right pr-3 border-t">
                {time}
              </div>
              {dates.map((date) => {
                const key = slotKey(date, time)
                const names = heatmap.get(key) || []
                const isSelected = mySlots.has(key)
                const isBusy = busySlots.has(key)
                const isHighlighted = highlightName && names.includes(highlightName)

                return (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <div
                        className={`
                          border-t border-l h-8 cursor-pointer transition-colors
                          ${isSelected ? 'ring-2 ring-primary ring-inset' : ''}
                          ${isBusy ? 'bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,0.08)_4px,rgba(0,0,0,0.08)_8px)]' : ''}
                          ${isHighlighted ? 'ring-2 ring-blue-400 ring-inset' : ''}
                        `}
                        style={{
                          backgroundColor: names.length > 0 ? heatColor(names.length) : undefined,
                        }}
                        onPointerDown={() => handlePointerDown(key)}
                        onPointerEnter={() => handlePointerEnter(key)}
                      />
                    </TooltipTrigger>
                    {names.length > 0 && (
                      <TooltipContent>
                        <p className="font-medium">{names.length}/{maxParticipants} available</p>
                        <p className="text-xs">{names.join(', ')}</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                )
              })}
            </>
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}
```

- [ ] **Step 2: Verify component renders**

Add a temporary test in Landing.jsx or create a test route. The grid should render with columns for dates and rows for time slots.

- [ ] **Step 3: Commit**

```bash
cd avails
git add client/src/components/AvailGrid.jsx
git commit -m "feat: AvailGrid component — drag-to-paint availability with heatmap overlay"
```

---

### Task 10: Client — PollView page (grid + responses + finalize)

**Files:**
- Create: `avails/client/src/components/NameEntry.jsx`
- Create: `avails/client/src/components/PollHeader.jsx`
- Create: `avails/client/src/components/ResponsePanel.jsx`
- Create: `avails/client/src/components/FinalizeDialog.jsx`
- Create: `avails/client/src/pages/PollView.jsx`
- Modify: `avails/client/src/App.jsx`

- [ ] **Step 1: Create NameEntry component**

Create `avails/client/src/components/NameEntry.jsx`:

```jsx
import { useState } from 'react'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Label } from './ui/label'

export default function NameEntry({ onSubmit }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <div className="space-y-2">
        <Label htmlFor="participant-name">Your name</Label>
        <Input
          id="participant-name"
          placeholder="Enter your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="participant-email">
          Email <span className="text-muted-foreground">(optional — for calendar invite)</span>
        </Label>
        <Input
          id="participant-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button onClick={() => onSubmit({ name, email })} disabled={!name.trim()}>
        Add my availability
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Create PollHeader**

Create `avails/client/src/components/PollHeader.jsx`:

```jsx
import { useState } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

export default function PollHeader({ poll, did, rkey }) {
  const [copied, setCopied] = useState(false)
  const pollUrl = `${window.location.origin}/p/${did}/${rkey}`

  function copyLink() {
    navigator.clipboard.writeText(pollUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{poll.title}</h1>
        <Badge variant={poll.status === 'open' ? 'default' : 'secondary'}>
          {poll.status}
        </Badge>
      </div>
      {poll.description && (
        <p className="text-muted-foreground">{poll.description}</p>
      )}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Timezone: {poll.timezone}</span>
        {poll.community && <Badge variant="outline">{poll.community}</Badge>}
      </div>
      <Button variant="outline" size="sm" onClick={copyLink}>
        {copied ? 'Copied!' : 'Copy link'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Create ResponsePanel**

Create `avails/client/src/components/ResponsePanel.jsx`:

```jsx
export default function ResponsePanel({ responses, highlightName, onHighlight }) {
  if (!responses.length) {
    return (
      <div className="text-sm text-muted-foreground p-4 border rounded-lg">
        No responses yet. Share the link to get started.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">
        {responses.length} {responses.length === 1 ? 'response' : 'responses'}
      </h3>
      <div className="space-y-1">
        {responses.map((r) => (
          <button
            key={r.name + r.createdAt}
            className={`
              w-full text-left px-3 py-2 rounded text-sm transition-colors
              ${highlightName === r.name ? 'bg-primary/10 font-medium' : 'hover:bg-muted'}
            `}
            onMouseEnter={() => onHighlight(r.name)}
            onMouseLeave={() => onHighlight(null)}
            onClick={() => onHighlight(highlightName === r.name ? null : r.name)}
          >
            {r.name}
            <span className="text-muted-foreground ml-2">{r.slots.length} slots</span>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create FinalizeDialog**

Create `avails/client/src/components/FinalizeDialog.jsx`:

```jsx
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { finalizePoll } from '../lib/api'

export default function FinalizeDialog({ open, onOpenChange, poll, did, rkey, onFinalized }) {
  const [selectedTime, setSelectedTime] = useState('')
  const [duration, setDuration] = useState(60)
  const [submitting, setSubmitting] = useState(false)

  async function handleFinalize() {
    if (!selectedTime) return
    setSubmitting(true)
    try {
      await finalizePoll(did, rkey, selectedTime, duration)
      onFinalized()
      onOpenChange(false)
    } catch (err) {
      console.error('Finalize error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pick a time for "{poll.title}"</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Selected time</Label>
            <Input
              type="datetime-local"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Duration (minutes)</Label>
            <Input
              type="number"
              min={15}
              step={15}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Calendar invites will be sent to all participants who left their email.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleFinalize} disabled={!selectedTime || submitting}>
            {submitting ? 'Scheduling...' : 'Schedule meeting'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5: Create PollView page**

Create `avails/client/src/pages/PollView.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router'
import { getPoll, getSession, submitResponse } from '../lib/api'
import AvailGrid from '../components/AvailGrid'
import NameEntry from '../components/NameEntry'
import PollHeader from '../components/PollHeader'
import ResponsePanel from '../components/ResponsePanel'
import FinalizeDialog from '../components/FinalizeDialog'
import { Button } from '../components/ui/button'

export default function PollView() {
  const { did, rkey } = useParams()
  const [poll, setPoll] = useState(null)
  const [responses, setResponses] = useState([])
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Participant state
  const [participant, setParticipant] = useState(null) // { name, email }
  const [mySlots, setMySlots] = useState(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // UI state
  const [highlightName, setHighlightName] = useState(null)
  const [showFinalize, setShowFinalize] = useState(false)

  const isCreator = session?.authenticated && session.did === did

  const fetchPoll = useCallback(async () => {
    try {
      const [pollData, sessionData] = await Promise.all([
        getPoll(did, rkey),
        getSession().catch(() => ({ authenticated: false })),
      ])
      setPoll(pollData.poll)
      setResponses(pollData.responses)
      setSession(sessionData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [did, rkey])

  useEffect(() => { fetchPoll() }, [fetchPoll])

  async function handleSubmitResponse() {
    if (!participant || mySlots.size === 0) return
    setSubmitting(true)
    try {
      await submitResponse(did, rkey, {
        name: participant.name,
        email: participant.email || undefined,
        slots: Array.from(mySlots),
      })
      setSubmitted(true)
      await fetchPoll() // Refresh to see new response
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="p-8 text-center">Loading...</div>
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>
  if (!poll) return <div className="p-8 text-center">Poll not found</div>

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4">
        <a href="/" className="text-xl font-semibold">avails</a>
      </header>

      <main className="px-6 py-8 max-w-6xl mx-auto">
        <PollHeader poll={poll} did={did} rkey={rkey} />

        <div className="mt-8 grid grid-cols-[1fr_280px] gap-8">
          {/* Main grid area */}
          <div className="space-y-4">
            {!participant && !submitted && poll.status === 'open' && (
              <NameEntry onSubmit={setParticipant} />
            )}

            {participant && !submitted && (
              <p className="text-sm text-muted-foreground">
                Click and drag to mark when you're available, <strong>{participant.name}</strong>.
              </p>
            )}

            <AvailGrid
              dates={poll.dates}
              timeRange={poll.timeRange}
              slotMinutes={poll.slotMinutes}
              responses={responses}
              mySlots={mySlots}
              onSlotsChange={setMySlots}
              readOnly={!participant || submitted}
              highlightName={highlightName}
            />

            {participant && !submitted && (
              <Button
                onClick={handleSubmitResponse}
                disabled={mySlots.size === 0 || submitting}
                size="lg"
              >
                {submitting ? 'Submitting...' : `Submit (${mySlots.size} slots)`}
              </Button>
            )}

            {submitted && (
              <p className="text-sm text-green-600 font-medium">
                Your availability has been submitted.
              </p>
            )}

            {isCreator && poll.status === 'open' && responses.length > 0 && (
              <Button variant="outline" onClick={() => setShowFinalize(true)}>
                Pick a time
              </Button>
            )}

            {poll.finalTime && (
              <div className="p-4 border rounded-lg bg-green-50">
                <p className="font-medium">Meeting scheduled</p>
                <p>{new Date(poll.finalTime).toLocaleString('en-US', {
                  dateStyle: 'full',
                  timeStyle: 'short',
                  timeZone: poll.timezone,
                })}</p>
                <p className="text-sm text-muted-foreground">{poll.finalDuration} minutes</p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside>
            <ResponsePanel
              responses={responses}
              highlightName={highlightName}
              onHighlight={setHighlightName}
            />
          </aside>
        </div>
      </main>

      {showFinalize && (
        <FinalizeDialog
          open={showFinalize}
          onOpenChange={setShowFinalize}
          poll={poll}
          did={did}
          rkey={rkey}
          onFinalized={fetchPoll}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Update App.jsx**

```jsx
import { Routes, Route } from 'react-router'
import Landing from './pages/Landing'
import PollView from './pages/PollView'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/p/:did/:rkey" element={<PollView />} />
    </Routes>
  )
}
```

- [ ] **Step 7: Verify full flow renders**

```bash
cd avails/client && npm run dev
# Navigate to / — should show landing
# Navigate to /p/test/test — should show poll view (will error on API call, but UI renders)
```

- [ ] **Step 8: Commit**

```bash
cd avails
git add client/
git commit -m "feat: PollView page with AvailGrid, NameEntry, ResponsePanel, FinalizeDialog"
```

---

### Task 11: Client — Google Calendar overlay

**Files:**
- Create: `avails/client/src/lib/googleCalendar.js`
- Modify: `avails/client/src/components/NameEntry.jsx`

- [ ] **Step 1: Create Google Calendar helper**

Create `avails/client/src/lib/googleCalendar.js`:

```javascript
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly'

let tokenClient = null

export function isGoogleConfigured() {
  return !!GOOGLE_CLIENT_ID
}

/**
 * Initialize Google Identity Services and request calendar access.
 * Returns an access token.
 */
export function requestGoogleAccess() {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services not loaded'))
      return
    }

    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) reject(new Error(response.error))
        else resolve(response.access_token)
      },
    })

    tokenClient.requestAccessToken()
  })
}

/**
 * Fetch busy times from Google Calendar for given date range.
 * @param {string} accessToken
 * @param {string[]} dates - Array of "YYYY-MM-DD" strings
 * @param {string} timezone
 * @returns {Set<string>} Set of busy slot keys ("YYYY-MM-DDThh:mm")
 */
export async function fetchBusyTimes(accessToken, dates, timezone) {
  const sortedDates = [...dates].sort()
  const timeMin = new Date(`${sortedDates[0]}T00:00:00`).toISOString()
  const lastDate = new Date(`${sortedDates[sortedDates.length - 1]}T23:59:59`)
  const timeMax = lastDate.toISOString()

  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: timezone,
      items: [{ id: 'primary' }],
    }),
  })

  const data = await res.json()
  const busyPeriods = data.calendars?.primary?.busy || []

  // Convert busy periods to 30-min slot keys
  const busySlots = new Set()
  for (const period of busyPeriods) {
    const start = new Date(period.start)
    const end = new Date(period.end)
    let current = new Date(start)

    while (current < end) {
      const date = current.toISOString().split('T')[0]
      const hours = String(current.getHours()).padStart(2, '0')
      const mins = String(current.getMinutes()).padStart(2, '0')
      busySlots.add(`${date}T${hours}:${mins}`)
      current = new Date(current.getTime() + 30 * 60 * 1000)
    }
  }

  return busySlots
}
```

- [ ] **Step 2: Add Google Calendar button to NameEntry**

Update `avails/client/src/components/NameEntry.jsx` — add a "Connect Google Calendar" button after the name/email fields:

```jsx
import { useState } from 'react'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { isGoogleConfigured, requestGoogleAccess, fetchBusyTimes } from '../lib/googleCalendar'

export default function NameEntry({ onSubmit, dates, timezone, onBusySlots }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [connectingCalendar, setConnectingCalendar] = useState(false)

  async function connectCalendar() {
    setConnectingCalendar(true)
    try {
      const token = await requestGoogleAccess()
      const busy = await fetchBusyTimes(token, dates, timezone)
      onBusySlots(busy)
      setCalendarConnected(true)
    } catch (err) {
      console.error('Google Calendar error:', err)
    } finally {
      setConnectingCalendar(false)
    }
  }

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <div className="space-y-2">
        <Label htmlFor="participant-name">Your name</Label>
        <Input
          id="participant-name"
          placeholder="Enter your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="participant-email">
          Email <span className="text-muted-foreground">(optional — for calendar invite)</span>
        </Label>
        <Input
          id="participant-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {isGoogleConfigured() && !calendarConnected && (
        <Button
          variant="outline"
          size="sm"
          onClick={connectCalendar}
          disabled={connectingCalendar}
        >
          {connectingCalendar ? 'Connecting...' : 'Connect Google Calendar'}
        </Button>
      )}
      {calendarConnected && (
        <p className="text-sm text-green-600">Calendar connected — busy times shown on grid</p>
      )}

      <Button onClick={() => onSubmit({ name, email })} disabled={!name.trim()}>
        Add my availability
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Wire up busySlots in PollView**

In `avails/client/src/pages/PollView.jsx`, add `busySlots` state and pass to AvailGrid and NameEntry:

```jsx
const [busySlots, setBusySlots] = useState(new Set())

// In NameEntry:
<NameEntry
  onSubmit={setParticipant}
  dates={poll.dates}
  timezone={poll.timezone}
  onBusySlots={setBusySlots}
/>

// In AvailGrid:
<AvailGrid
  ...
  busySlots={busySlots}
/>
```

- [ ] **Step 4: Add Google Identity Services script to index.html**

Add to `avails/client/index.html` `<head>`:

```html
<script src="https://accounts.google.com/gsi/client" async defer></script>
```

- [ ] **Step 5: Commit**

```bash
cd avails
git add client/
git commit -m "feat: Google Calendar overlay — connect calendar, show busy times as hatched cells"
```

---

### Task 12: Deployment — Railway + custom domain

**Files:**
- Modify: `avails/Procfile` (already created)
- Create: `avails/railway.json`

- [ ] **Step 1: Create railway.json**

Create `avails/railway.json`:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "cd client && npm install && npm run build && cd ../server && npm install"
  },
  "deploy": {
    "startCommand": "cd server && node src/index.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

- [ ] **Step 2: Create GitHub repo and push**

```bash
cd avails
gh repo create zhiganov/avails --public --source=. --push
```

- [ ] **Step 3: Create Railway project and deploy**

Use Railway MCP or CLI to create a project, link to the GitHub repo, set environment variables (ATPROTO_CLIENT_ID, ATPROTO_REDIRECT_URI, SESSION_SECRET, RESEND_API_KEY, CLIENT_URL), and deploy.

- [ ] **Step 4: Configure custom domain**

Set up `avails.zhgnv.com` as custom domain in Railway.

- [ ] **Step 5: Commit**

```bash
cd avails
git add railway.json
git commit -m "feat: Railway deployment config"
```

---

### Task 13: MC integration — avails store + banner

**Files:**
- Create: `my-community/extension/src/store/avails.js`
- Create: `my-community/extension/src/components/AvailsBanner.jsx`
- Create: `my-community/extension/src/styles/avails.css`
- Modify: `my-community/extension/src/app.jsx`
- Modify: `my-community/extension/src/components/SessionsPanel.jsx`
- Modify: `my-community/extension/public/manifest.json`

- [ ] **Step 1: Create avails store**

Create `my-community/extension/src/store/avails.js`:

```javascript
import { signal } from '@preact/signals';
import { selectedCommunityIds } from './communities';

const AVAILS_API = 'https://avails.zhgnv.com/api/polls';
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

export const availsPolls = signal([]);

let pollTimer = null;

async function loadPolls() {
  try {
    const communities = selectedCommunityIds.value;
    if (!communities?.length) {
      availsPolls.value = [];
      return;
    }

    const allPolls = [];
    for (const id of communities) {
      const res = await fetch(`${AVAILS_API}?community=${id}&status=open`);
      if (res.ok) {
        const polls = await res.json();
        allPolls.push(...polls);
      }
    }

    // Deduplicate by did/rkey
    const seen = new Set();
    availsPolls.value = allPolls.filter(p => {
      const key = `${p.did}/${p.rkey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (err) {
    console.error('Failed to load avails polls:', err);
  }
}

export function startAvailsPolling() {
  loadPolls();
  pollTimer = setInterval(loadPolls, POLL_INTERVAL);
}

export function stopAvailsPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
  availsPolls.value = [];
}
```

- [ ] **Step 2: Create AvailsBanner component**

Create `my-community/extension/src/components/AvailsBanner.jsx`:

```jsx
import { availsPolls } from '../store/avails';
import '../styles/avails.css';

export default function AvailsBanner() {
  const polls = availsPolls.value;
  if (!polls.length) return null;

  return (
    <div class="avails-banner-container">
      {polls.map((poll) => (
        <a
          key={`${poll.did}/${poll.rkey}`}
          class="avails-banner"
          href={`https://avails.zhgnv.com/p/${poll.did}/${poll.rkey}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="avails-banner-icon">📅</span>
          <span class="avails-banner-text">
            <strong>{poll.title}</strong>
            <em>{poll.responseCount} {poll.responseCount === 1 ? 'response' : 'responses'}</em>
          </span>
          <span class="avails-banner-cta">Add availability →</span>
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create avails.css**

Create `my-community/extension/src/styles/avails.css` — style the banner following MC's design system (warm palette, card animations). Use `frontend-design` skill for the actual implementation.

- [ ] **Step 4: Wire up in app.jsx and SessionsPanel**

In `my-community/extension/src/app.jsx`, add:

```javascript
import { startAvailsPolling, stopAvailsPolling } from './store/avails';
```

Start/stop polling alongside session loading when selected communities change.

In `my-community/extension/src/components/SessionsPanel.jsx`, add `<AvailsBanner />` above events (same position as JamBanner).

- [ ] **Step 5: Update manifest.json**

Add to `my-community/extension/public/manifest.json` permissions:

```json
"https://avails.zhgnv.com/*"
```

- [ ] **Step 6: Build and verify**

```bash
cd my-community/extension && npm run build
# Verify no build errors
```

- [ ] **Step 7: Update MC CLAUDE.md**

Add avails store and component to the CLAUDE.md documentation (already partially done in this session).

- [ ] **Step 8: Commit**

```bash
cd my-community
git add extension/
git commit -m "feat: avails integration — poll banners in participation feed"
```

---

## Self-Review

**Spec coverage check:**
- Lexicons: Task 2 ✓
- ATProto OAuth: Task 3 ✓
- Poll CRUD: Task 4 ✓
- Response submission: Task 5 ✓
- Creator notifications: Task 5 ✓
- .ics email on finalize: Task 6 ✓
- Communities proxy: Task 7 ✓
- PollCreator (single page): Task 8 ✓
- AvailGrid (drag-to-paint, heatmap, tooltips): Task 9 ✓
- PollView (grid + responses + finalize): Task 10 ✓
- Google Calendar overlay: Task 11 ✓
- Railway deployment: Task 12 ✓
- MC integration: Task 13 ✓
- Telegram bot: explicitly deferred (service #2, not in this plan)
- DN integration: explicitly deferred

**Type consistency check:**
- `POLL_COLLECTION` = `'chat.avails.scheduling.poll'` — consistent across polls.js and responses.js
- `RESPONSE_COLLECTION` = `'chat.avails.scheduling.response'` — consistent
- `pollUri` format `at://${did}/${POLL_COLLECTION}/${rkey}` — consistent between routes and lexicon `format: "at-uri"`
- `mySlots` is `Set<string>` in client, converted to `Array.from(mySlots)` before API call, stored as `slots: string[]` in lexicon — consistent
- `slotKey` format `YYYY-MM-DDThh:mm` — consistent between AvailGrid and googleCalendar.js

**Placeholder scan:** No TBDs except one intentional `// TODO: resolve DID to PDS URL` in polls.js — this is using bsky.social as default PDS for now, which works for most users. A proper DID resolver can be added later.
