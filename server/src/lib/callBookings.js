import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const CALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RETENTION_MS = 30 * 86400_000;
const MAX_BOOKINGS = 5000;

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

// Private, local-volume state, never a PDS record. All mutations are serialized;
// an atomic replacement succeeds BEFORE the in-memory snapshot is published.
// Like Avails' other volume stores, this requires a single service replica.
export function createCallBookingStore({ dataDir, now = Date.now } = {}) {
  let records;
  let storeDirectory;
  let queue = Promise.resolve();
  const directory = () => (storeDirectory ||= dataDir || process.env.DATA_DIR || './data');
  const file = () => path.join(directory(), 'private-call-bookings.json');
  const retained = (b) => now() < Math.max(
    Date.parse(b.bookedAt) + RETENTION_MS,
    Date.parse(`${b.slot}:00Z`) + b.durationMinutes * 60000 + 7 * 86400_000,
  );

  async function load() {
    if (records) return;
    try {
      const parsed = JSON.parse(await readFile(file(), 'utf8'));
      if (!Array.isArray(parsed) || parsed.some((b) => !b || !CALL_ID_RE.test(b.id)
        || typeof b.title !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.slot)
        || !Number.isInteger(b.durationMinutes) || b.durationMinutes <= 0
        || !Number.isFinite(Date.parse(b.bookedAt)) || !b.participants
        || typeof b.participants !== 'object' || Array.isArray(b.participants)
        || Object.values(b.participants).some((p) => !p || !['pending', 'accepted', 'declined'].includes(p.state)))) {
        throw new Error('Invalid private call booking store');
      }
      records = new Map(parsed.map((b) => [b.id, b]));
    } catch (err) {
      // Never echo private serialized data through a parse error or API response.
      if (err.code !== 'ENOENT') fail(503, 'Private call booking storage is unavailable');
      records = new Map();
    }
  }

  function serialized(fn) {
    const work = queue.then(async () => { await load(); return fn(); });
    queue = work.catch(() => {});
    return work;
  }

  async function commit(next) {
    await mkdir(directory(), { recursive: true });
    const temporary = `${file()}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify([...next.values()]), { mode: 0o600, flush: true });
      await rename(temporary, file());
      records = next;
    } catch {
      fail(503, 'Could not save the call choice. Please try again');
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  function required(id) {
    const booking = CALL_ID_RE.test(String(id)) && records.get(id);
    if (!booking || !retained(booking)) fail(404, 'Call not found');
    return booking;
  }

  return {
    find: (caller, key) => serialized(() => {
      const found = [...records.values()].find(
        (b) => retained(b) && b.caller === caller && b.idempotencyKey === key,
      );
      return found ? structuredClone(found) : undefined;
    }),
    create: (input) => serialized(async () => {
      if (input.idempotencyKey) {
        const prior = [...records.values()].find((b) => retained(b)
          && b.caller === input.caller && b.idempotencyKey === input.idempotencyKey);
        if (prior) {
          if (prior.scope.type !== input.scope.type || prior.scope.value !== input.scope.value) {
            fail(409, 'This idempotencyKey already belongs to a different scope');
          }
          return { booking: structuredClone(prior), created: false };
        }
      }
      const next = new Map([...records].filter(([, b]) => retained(b)));
      if (next.size >= MAX_BOOKINGS) fail(503, 'Call booking storage is full');
      const booking = {
        id: randomUUID(), bookedAt: new Date(now()).toISOString(),
        caller: input.caller, ownerDid: input.ownerDid || null,
        idempotencyKey: input.idempotencyKey || null,
        scope: input.scope, title: input.title, slot: input.slot,
        durationMinutes: input.durationMinutes, coverage: input.coverage,
        participants: Object.fromEntries(input.participants.map((did) => [did, {
          state: input.autoBooked.includes(did) ? 'accepted' : 'pending',
          automatic: input.autoBooked.includes(did),
        }])),
      };
      next.set(booking.id, booking);
      await commit(next);
      return { booking: structuredClone(booking), created: true };
    }),
    get: (id) => serialized(() => structuredClone(required(id))),
    decide: (id, did, decision) => serialized(async () => {
      const booking = required(id);
      const participant = booking.participants[did];
      if (!participant) fail(404, 'Call not found');
      if (!['accept', 'decline'].includes(decision)) fail(400, 'Choose accept or decline');
      const state = decision === 'accept' ? 'accepted' : 'declined';
      if (participant.state === state) return structuredClone(booking);
      if (participant.state !== 'pending') fail(409, 'Your choice is already saved');
      if (Date.parse(`${booking.slot}:00Z`) <= now()) fail(410, 'This time has already passed');
      const updated = structuredClone(booking);
      updated.participants[did] = { ...participant, state, decidedAt: new Date(now()).toISOString() };
      const next = new Map(records);
      next.set(id, updated);
      await commit(next);
      return structuredClone(updated);
    }),
    resetForTest: () => { records = new Map(); },
  };
}

export const callBookingStore = createCallBookingStore();

// Shared production seam for the actual CA-client/Avails contract regression.
// Slot selection stays outside this function; the consent grant does not.
// Support clears the coverage floor regardless of trust mix. Only exactly auto
// grants acceptance; missing/unknown values remain pending, never invited.
export async function bookStandingCall({
  store = callBookingStore, members, participants, slot, durationMinutes, title,
  scope, coverage, caller, ownerDid, idempotencyKey,
}) {
  const byDid = new Map(members.map((member) => [member.did, member]));
  const uniqueParticipants = [...new Set(participants)];
  const autoBooked = uniqueParticipants.filter((did) => byDid.get(did)?.record?.value?.trust === 'auto');
  return store.create({
    participants: uniqueParticipants, autoBooked, slot, durationMinutes, title,
    scope, coverage, caller, ownerDid, idempotencyKey,
  });
}

export function callBookingResult(booking) {
  const participants = Object.keys(booking.participants);
  const state = (value) => participants.filter((did) => booking.participants[did].state === value);
  const origin = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
  return {
    booked: true, bookedAt: booking.bookedAt,
    bookingId: booking.id, bookingUrl: `${origin}/calls/${booking.id}`,
    slot: booking.slot, title: booking.title, durationMinutes: booking.durationMinutes,
    participants, autoBooked: participants.filter((did) => booking.participants[did].automatic),
    confirmed: state('accepted'), needsConfirm: state('pending'), declined: state('declined'),
    coverage: booking.coverage,
  };
}

export function callParticipantView(booking, did) {
  const participant = booking.participants[did];
  if (!participant) fail(404, 'Call not found');
  return {
    bookingId: booking.id, title: booking.title, slot: booking.slot,
    durationMinutes: booking.durationMinutes, state: participant.state,
    automatic: participant.automatic,
    canDecide: participant.state === 'pending' && Date.parse(`${booking.slot}:00Z`) > Date.now(),
    canDownload: participant.state === 'accepted',
  };
}
