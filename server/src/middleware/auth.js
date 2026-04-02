import { getSession, sessions } from '../lib/sessionStore.js';

export function requireAuth(req, res, next) {
  const sessionId = req.cookies?.avails_session;
  if (!sessionId) {
    console.log('requireAuth: no avails_session cookie. Cookies:', Object.keys(req.cookies || {}));
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const session = getSession(sessionId);
  if (!session) {
    console.log(`requireAuth: session not found. ID prefix: ${sessionId.substring(0, 8)}... Store has ${sessions.size} sessions.`);
    return res.status(401).json({ error: 'Session expired' });
  }

  req.userDid = session.did;
  req.userHandle = session.handle;
  req.oauthSession = session.oauthSession;
  next();
}
