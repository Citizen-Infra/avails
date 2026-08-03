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
import { startPersistence, markDirty, saveNow } from './lib/persistence.js';
import { backfillCommunityFeedPublished } from './lib/pollIndex.js';
import { restoreOAuthSessions, sessions } from './lib/sessionStore.js';
import { spaFallback } from './middleware/spaFallback.js';
import mcpOauthRoutes from './mcp/oauth.js';
import { handleMcp, handleMcpDelete } from './mcp/handler.js';
import { pollOgHandler } from './lib/og.js';

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

// Admin: clear all sessions (requires SESSION_SECRET as query param)
app.post('/api/admin/clear-sessions', async (req, res) => {
  if (req.query.key !== process.env.SESSION_SECRET) {
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
  app.listen(PORT, async () => {
    console.log(`Avails server listening on port ${PORT}`);
    try {
      const client = await getClient();
      await restoreOAuthSessions(client);
    } catch (err) {
      console.warn('Could not restore OAuth sessions:', err.message);
    }
  });
}
start();
