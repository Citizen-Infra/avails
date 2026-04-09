import crypto from 'crypto';
import { markDirty, saveNow } from './persistence.js';

// In-memory store: sessionId → { did, handle, createdAt }
// The oauthSession object is NOT stored here — it's rebuilt via client.restore(did)
// Export the Map so persistence.js can save/restore it
export const sessions = new Map();

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Remove sessions older than 30 days. Call on startup after loading from disk.
 */
export function cleanupExpiredSessions() {
  const cutoff = Date.now() - SESSION_MAX_AGE_MS;
  let removed = 0;
  for (const [sessionId, data] of sessions) {
    if (data.createdAt && data.createdAt < cutoff) {
      sessions.delete(sessionId);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`Cleaned up ${removed} expired app sessions`);
    markDirty('app-sessions');
  }
}

export function createSession(oauthSession, did, handle) {
  // Remove any existing sessions for this DID — ATProto only allows one active
  // session per DID, so stale entries would cause "session was deleted" errors
  for (const [existingId, data] of sessions) {
    if (data.did === did) {
      sessions.delete(existingId);
    }
  }

  const sessionId = crypto.randomBytes(32).toString('hex');
  sessions.set(sessionId, {
    oauthSession, // live object — not serialized, rebuilt on restore
    did,
    handle,
    createdAt: Date.now(),
  });
  markDirty('app-sessions');
  saveNow().catch(err => console.error('Failed to save after createSession:', err.message));
  return sessionId;
}

export function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

export function deleteSession(sessionId) {
  sessions.delete(sessionId);
  markDirty('app-sessions');
  saveNow().catch(err => console.error('Failed to save after deleteSession:', err.message));
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
  // Remove stale sessions before restoring live OAuth sessions
  cleanupExpiredSessions();

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
      markDirty('app-sessions');
    }
  }
  if (restored > 0) {
    console.log(`Restored ${restored} live OAuth sessions`);
  }
}
