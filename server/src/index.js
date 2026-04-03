import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes, { getClient } from './routes/auth.js';
import pollRoutes from './routes/polls.js';
import responseRoutes from './routes/responses.js';
import communityRoutes from './routes/communities.js';
import { startPersistence } from './lib/persistence.js';
import { restoreOAuthSessions } from './lib/sessionStore.js';

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

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Auth routes (login, callback, session, logout, client-metadata, jwks)
app.use('/api/auth', authRoutes);

// Poll CRUD + community listing
app.use('/api/polls', pollRoutes);

// Response submission (nested: /api/polls/:did/:rkey/responses)
app.use('/api/polls', responseRoutes);

// Communities proxy
app.use('/api/communities', communityRoutes);

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

// Start server, then restore sessions (must listen first — session restore
// calls client-metadata endpoint on itself)
// Catch unhandled rejections from ATProto OAuth SDK background token refreshes
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message || err);
  // Don't crash — the OAuth SDK throws TokenRefreshError asynchronously
  // when sessions become stale. Log and continue.
});

async function start() {
  await startPersistence();
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
