import { getSession } from '../lib/sessionStore.js';

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
