import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes, { getClient, oauthSessionStore } from './routes/auth.js';
import pollRoutes from './routes/polls.js';
import responseRoutes from './routes/responses.js';
import availabilityRoutes from './routes/availability.js';
import communityRoutes from './routes/communities.js';
import openmeetRoutes from './routes/openmeet.js';
import { corsOriginCheck } from './lib/corsOrigins.js';
import { legacyHostRedirect } from './middleware/legacyHostRedirect.js';
import { startPersistence, markDirty, saveNow } from './lib/persistence.js';
import { backfillCommunityFeedPublished } from './lib/pollIndex.js';
import { cleanupExpiredSessions, sessions } from './lib/sessionStore.js';
import { spaFallback } from './middleware/spaFallback.js';
import mcpOauthRoutes from './mcp/oauth.js';
import { handleMcp, handleMcpDelete, handleMcpGet } from './mcp/handler.js';
import { pollOgHandler } from './lib/og.js';
import { secretMatches, bearerFrom } from './lib/bearerAuth.js';

dotenv.config();

// Validate required environment variables at startup
const REQUIRED_VARS = ['ATPROTO_CLIENT_ID', 'ATPROTO_REDIRECT_URI', 'ATPROTO_PRIVATE_KEY', 'SESSION_SECRET'];
const missing = REQUIRED_VARS.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('See server/.env.example for required configuration.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Railway (rate limiting needs real IPs)
app.set('trust proxy', 1);

app.use(cors({
  origin: corsOriginCheck,
  credentials: true,
}));

// Retired hosts forward here (#150). Placed AFTER cors so a preflight is still
// answered normally — browsers do not follow redirects on OPTIONS, so putting
// this first would break CORS for anything still calling the old host — and
// BEFORE express.json, since a 308 never reads the body.
app.use(legacyHostRedirect);

app.use(express.json());
app.use(cookieParser());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path.startsWith('/api') || req.path.startsWith('/mcp')) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: { error: 'Too many auth attempts. Try again later.' },
});

const pollCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Too many polls created. Try again later.' },
});

const responseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { error: 'Too many responses. Try again later.' },
});

const availabilityCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Too many availability records created. Try again later.' },
});

// The MCP tools are unauthenticated by design (they read public PDS records),
// but schedule_call fans out to plc.directory plus every member's PDS — a
// 22-member list is ~44 third-party requests for one call. That makes /mcp the
// largest amplification surface here, so it gets the same treatment as every
// other public entry point. 60/hr matches responseLimiter, the most permissive
// existing tier: generous for real agent use (a session is 10-20 calls) while
// capping fan-out at roughly 1.3k third-party requests/hr from any one IP.
const mcpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { error: 'Too many MCP requests. Try again later.' },
});

// Auth routes (login, callback, session, logout, client-metadata, jwks)
app.use('/api/auth/login', authLimiter);
app.use('/api/auth', authRoutes);

// Poll CRUD + community listing
app.post('/api/polls', pollCreateLimiter);
app.use('/api/polls', pollRoutes);

// Response submission (nested: /api/polls/:did/:rkey/responses)
app.post('/api/polls/:did/:rkey/responses', responseLimiter);
app.use('/api/polls', responseRoutes);

// Standing-availability CRUD (writes to the caller's own PDS)
app.post('/api/availability', availabilityCreateLimiter);
app.use('/api/availability', availabilityRoutes);

// Communities proxy
app.use('/api/communities', communityRoutes);

// OpenMeet integration
app.use('/api/openmeet', openmeetRoutes);

// MCP well-known endpoints (mounted at root level)
app.use('/', mcpOauthRoutes);

// MCP OAuth routes (register, authorize, callback, token)
app.use('/mcp', mcpOauthRoutes);

// MCP JSON-RPC endpoint. Rate-limited here rather than on the whole /mcp
// prefix so the multi-step OAuth flow mounted above doesn't spend the tool
// budget. DELETE is session teardown, not a fan-out surface, so it's exempt.
app.post('/mcp', mcpLimiter, handleMcp);
app.delete('/mcp', handleMcpDelete);

// GET /mcp is how a client opens a server-to-client SSE stream. We don't offer
// one, and the spec's answer for that is 405 — not the SPA shell this used to
// fall through to. Must be registered before express.static/spaFallback, and it
// matches /mcp exactly so the OAuth sub-routes mounted above are untouched.
app.get('/mcp', handleMcpGet);

// Admin: clear all sessions. Logs every user out, so it is credentialed.
//
// The credential arrives in an Authorization header and has its own variable.
// It used to be SESSION_SECRET read from `?key=`, which was two problems at
// once (#156): a secret in a URL is recorded by access logs, proxies, browser
// history and Referer headers, and that same value was the HS256 signing key
// for every MCP access token.
//
// Fails closed when AVAILS_ADMIN_SECRET is unset — an admin endpoint with no
// credential configured must deny, never fall back to another secret.
app.post('/api/admin/clear-sessions', async (req, res) => {
  if (!secretMatches(bearerFrom(req), process.env.AVAILS_ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid key' });
  }
  const appCount = sessions.size;
  const oauthCount = oauthSessionStore.size;
  sessions.clear();
  oauthSessionStore.clear();
  markDirty('app-sessions');
  markDirty('oauth-sessions');
  await saveNow();
  console.log(`Admin: cleared ${appCount} app sessions + ${oauthCount} OAuth sessions`);
  res.json({ cleared: { app: appCount, oauth: oauthCount } });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve static client build in production
const clientDist = path.join(__dirname, '../../client/dist');

// Intercept poll URLs BEFORE express.static so we can inject per-poll Open
// Graph metadata for link-preview crawlers (Telegram, Slack, Discord, etc).
// SPA crawlers don't run JS, so the HTML has to carry the tags.
app.get('/p/:did/:rkey', pollOgHandler(clientDist));

app.use(express.static(clientDist));

// SPA fallback — serves the client shell, 404s unmatched /api paths (#109)
app.get('*', spaFallback(clientDist));

// JSON error handler — all API errors return structured JSON
app.use((err, req, res, next) => {
  console.error(`Error in ${req.method} ${req.path}:`, err.message);
  if (req.path.startsWith('/api')) {
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
    });
  } else {
    next(err);
  }
});

// Catch unhandled rejections from ATProto OAuth SDK background token refreshes
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message || err);
});

async function start() {
  await startPersistence();
  // One-time grandfather of open polls into the community feed (#5 sub-project F),
  // after the index is restored and before serving. Idempotent across restarts.
  const grandfathered = backfillCommunityFeedPublished();
  if (grandfathered > 0) {
    console.log(`Community feed: grandfathered ${grandfathered} open poll(s) as published`);
  }

  // Drop sessions that can never be used again. Purely local, so it runs before
  // listen — unlike the OAuth restore that used to happen here (#117), which
  // needed our public host to be reachable by a REMOTE authorization server and
  // therefore could not be sequenced correctly from inside this process at all.
  // Sessions now come back on the first request that needs one.
  cleanupExpiredSessions();

  app.listen(PORT, async () => {
    console.log(`Avails server listening on port ${PORT}`);
    // Build the OAuth client eagerly. No network I/O — the client metadata is a
    // literal object — but it does import and validate ATPROTO_PRIVATE_KEY, so
    // a malformed key surfaces in the boot log instead of at a user's sign-in.
    try {
      await getClient();
    } catch (err) {
      console.error('OAuth client failed to initialise — sign-in will not work:', err.message);
    }
  });
}
start();
