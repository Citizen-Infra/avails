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

// Start server with session restoration
async function start() {
  await startPersistence();
  try {
    const client = await getClient();
    await restoreOAuthSessions(client);
  } catch (err) {
    console.warn('Could not restore OAuth sessions:', err.message);
  }
  app.listen(PORT, () => {
    console.log(`Avails server listening on port ${PORT}`);
  });
}
start();
