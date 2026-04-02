import crypto from 'crypto';
import { markDirty } from './persistence.js';

// In-memory store: sessionId → { did, handle, createdAt }
// The oauthSession object is NOT stored here — it's rebuilt via client.restore(did)
// Export the Map so persistence.js can save/restore it
export const sessions = new Map();

export function createSession(oauthSession, did, handle) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  sessions.set(sessionId, {
    oauthSession, // live object — not serialized, rebuilt on restore
    did,
    handle,
    createdAt: Date.now(),
  });
  markDirty('app-sessions');
  return sessionId;
}

export function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

export function deleteSession(sessionId) {
  sessions.delete(sessionId);
  markDirty('app-sessions');
}

export function getOAuthSession(sessionId) {
  const session = getSession(sessionId);
  return session?.oauthSession || null;
}

/**
 * After loading app-sessions from disk, the oauthSession field is missing
 * (it's a live object that can't be serialized). Call this with the OAuth client
 * to rebuild live sessions via client.restore(did).
 */
export async function restoreOAuthSessions(client) {
  let restored = 0;
  for (const [sessionId, data] of sessions) {
    if (data.oauthSession) continue; // already live
    if (!data.did) {
      sessions.delete(sessionId);
      continue;
    }
    try {
      const oauthSession = await client.restore(data.did);
      data.oauthSession = oauthSession;
      restored++;
    } catch (err) {
      console.warn(`Failed to restore OAuth session for ${data.did}:`, err.message);
      sessions.delete(sessionId);
    }
  }
  if (restored > 0) {
    console.log(`Restored ${restored} live OAuth sessions`);
  }
}
