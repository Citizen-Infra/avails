import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
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

// Trust proxy for Railway (rate limiting needs real IPs)
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path.startsWith('/api')) {
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

// Auth routes (login, callback, session, logout, client-metadata, jwks)
app.use('/api/auth/login', authLimiter);
app.use('/api/auth', authRoutes);

// Poll CRUD + community listing
app.post('/api/polls', pollCreateLimiter);
app.use('/api/polls', pollRoutes);

// Response submission (nested: /api/polls/:did/:rkey/responses)
app.post('/api/polls/:did/:rkey/responses', responseLimiter);
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
