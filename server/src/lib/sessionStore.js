import crypto from 'crypto';

// In-memory store: sessionId → { oauthSession, did, handle, createdAt }
// Export the Map so other modules can scan it (e.g., finding creator session for anonymous writes)
export const sessions = new Map();

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
