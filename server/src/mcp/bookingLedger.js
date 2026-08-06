// A memory of the calls schedule_call has already booked, so a retried request
// returns the first booking instead of making a second one (#166).
//
// The window this closes is the LOST RESPONSE, and it is structural. A request
// that books here and fails to reach the caller — a timeout at 15s while the
// booking completed at 16s, a dropped connection, a container replaced
// mid-reply — is indistinguishable, from the caller's side, from one that never
// arrived. community-admin's fire() deliberately retries that case rather than
// recording it as "avails declined", because recording a network failure as a
// refusal would tell a community nobody could meet when in fact nobody was
// asked. That is the right call there, and it is precisely why no amount of
// caller-side locking fixes this: the caller genuinely does not know. Only the
// callee can answer, and only by remembering.
//
// The blast radius is not a stray row. It is a second calendar invitation to
// every participant, for a call that was already booked.
//
// Keyed on a caller-supplied key rather than on the request's shape: two
// genuinely different calls for the same group in the same window are
// legitimate, so a natural key would silently collapse them (#166 option 2,
// rejected there for that reason).

import { registerStore, markDirty, saveStoreNow } from '../lib/persistence.js';

const STORE = 'call-bookings';

// How long a key is honoured. A retry normally arrives within seconds, but
// community-admin's trigger is read-driven and can go quiet for days, so this
// is generous. Callers derive keys from something one-shot (a proposal id), so
// a key does not legitimately repeat inside the window.
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Backstop only: retention alone is unbounded if bookings ever arrive faster
// than they expire, and this Map lives in a small container's memory.
const MAX_ENTRIES = 5000;

const bookings = new Map(); // key → { bookedAt, result }
registerStore(STORE, bookings);

// Keys currently being booked, deliberately NOT persisted. A claim is only
// meaningful while the process holding it is alive; a restart should forget
// them, because the alternative is a key stuck in-flight forever with nobody
// left to resolve it. This closes the concurrency window WITHIN one process —
// avails runs a single service, but if it is ever replicated this guard stops
// at the process boundary and the durable ledger below is what still holds.
const inFlight = new Set();

function expired(entry, now) {
  return now - new Date(entry.bookedAt).getTime() > RETENTION_MS;
}

function prune() {
  const now = Date.now();
  for (const [key, entry] of bookings) {
    if (expired(entry, now)) bookings.delete(key);
  }
  // Oldest first — Map preserves insertion order, and loadAll restores in the
  // order the file was written.
  while (bookings.size > MAX_ENTRIES) {
    bookings.delete(bookings.keys().next().value);
  }
}

// The booking previously made under this key, or undefined.
export function recallBooking(key) {
  const entry = bookings.get(key);
  if (!entry) return undefined;
  if (expired(entry, Date.now())) {
    bookings.delete(key);
    markDirty(STORE);
    return undefined;
  }
  return entry;
}

// Claim a key for the duration of one booking attempt. Returns false if
// another attempt already holds it. Check-and-set with no await between them,
// so two overlapping calls cannot both win.
export function claimBooking(key) {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function releaseBooking(key) {
  inFlight.delete(key);
}

// Record a booking durably. Awaits the write rather than leaving it to the
// 30-second flush: the whole point is to survive a container that dies
// immediately after booking, which is the flush interval's blind spot.
export async function rememberBooking(key, result) {
  bookings.set(key, { bookedAt: new Date().toISOString(), result });
  prune();
  markDirty(STORE);
  await saveStoreNow(STORE);
}

// Test seam: the store is module-level state shared by every import.
export function _resetBookingLedger() {
  bookings.clear();
  inFlight.clear();
}
