import { getSession, sessions } from '../lib/sessionStore.js';
import { getClient } from '../routes/auth.js';

export async function requireAuth(req, res, next) {
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

  // The startup restore fetches client-metadata.json from our own PUBLIC URL,
  // which Railway's edge doesn't route to until the deploy is healthy — so on
  // every redeploy it fails with invalid_client_metadata, sets oauthSession to
  // null, and logs "will retry on demand". Nothing here retried it, so the next
  // authenticated write dereferenced null and threw "Cannot read properties of
  // null (reading 'fetchHandler')" at a user whose cookie still looked valid.
  //
  // Deferring is sound — by the time a request arrives the deploy IS healthy and
  // the URL resolves, so restoring here succeeds where startup couldn't. It just
  // needed doing. Mirrors findOauthSessionByDid in routes/responses.js and the
  // restore in mcp/handler.js, which already do exactly this.
  if (!session.oauthSession && session.did) {
    try {
      const client = await getClient();
      session.oauthSession = await client.restore(session.did);
      console.log(`Lazy-restored OAuth session for ${session.did}`);
    } catch (err) {
      console.warn(`Lazy restore failed for ${session.did}:`, err.message);
      // Fail as "signed out" rather than passing null downstream. A grant we
      // can't restore isn't usable for writes, and telling the user to sign in
      // again actually repairs their state — a TypeError doesn't.
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
  }

  req.userDid = session.did;
  req.userHandle = session.handle;
  req.oauthSession = session.oauthSession;
  next();
}
