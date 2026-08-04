import crypto from 'crypto';
import { markDirty, saveNow } from './persistence.js';

// In-memory store: sessionId → { did, handle, createdAt }
// The oauthSession object is NOT stored here — it's rebuilt via client.restore(did)
// Export the Map so persistence.js can save/restore it
export const sessions = new Map();

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Drop sessions that can never be used again: past the 30-day cutoff, or
 * missing the DID that restoring one requires. Call on startup after loading
 * from disk.
 *
 * Deliberately local — no OAuth client, no network. A session that arrives
 * from disk with no live `oauthSession` is kept, not pruned: that is the normal
 * state of every session at boot (the live object is stripped before
 * serializing), and the request paths restore it on demand. See the note on
 * the boot sequence in index.js for why nothing restores here.
 */
export function cleanupExpiredSessions() {
  const cutoff = Date.now() - SESSION_MAX_AGE_MS;
  let expired = 0;
  let unrestorable = 0;
  for (const [sessionId, data] of sessions) {
    if (data.createdAt && data.createdAt < cutoff) {
      sessions.delete(sessionId);
      expired++;
    } else if (!data.did) {
      sessions.delete(sessionId);
      unrestorable++;
    }
  }
  if (expired > 0) {
    console.log(`Cleaned up ${expired} expired app sessions`);
  }
  if (unrestorable > 0) {
    console.log(`Cleaned up ${unrestorable} app sessions with no DID`);
  }
  if (expired + unrestorable > 0) {
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

// restoreOAuthSessions() used to live here: on boot it called
// client.restore(did) for every persisted session, to rebuild the live
// oauthSession that serialization strips. It is gone (#117).
//
// client.restore() refreshes the token against the user's PDS authorization
// server, and that server fetches our client_id URL to validate the
// private_key_jwt it is sent. The fetch is made by bsky.social, not by us — so
// it needs our PUBLIC host to be reachable, and on a fresh Railway container
// the edge does not route until the health check passes. Boot lost that race
// about half the time and the authorization server replied
// `invalid_client_metadata`.
//
// Because the fetcher is remote, no local ordering fixes it — running after
// app.listen() is necessary but not sufficient, which is exactly what the old
// comment on that constraint got wrong. The restore is now done by the request
// paths that already did it (requireAuth, findOauthSessionByDid in
// routes/responses.js, mcp/handler.js), which run when the edge is definitely
// routing because a request just arrived through it.
