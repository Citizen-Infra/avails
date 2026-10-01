import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCallBookingStore, bookStandingCall, callBookingResult, callParticipantView } from '../src/lib/callBookings.js';

const NOW = Date.parse('2030-01-01T00:00Z');
const members = ['auto', 'confirm', undefined, 'unknown'].map((trust, i) => ({
  did: `did:plc:person${i}`, record: { value: { trust } },
}));
const input = {
  members, participants: members.map((m) => m.did), slot: '2030-01-08T14:00',
  durationMinutes: 30, title: 'Planning call', caller: 'service',
  scope: { type: 'ca-community', value: 'test-community' },
  coverage: { withRecords: 4, membersFree: 4 }, idempotencyKey: 'test-proposal',
};

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'avails-private-call-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createCallBookingStore({ dataDir: dir, now: () => NOW });
  return { dir, store };
}

test('exact auto grant is accepted; missing/unknown grants are pending, with private participant views', async (t) => {
  const { store } = await fixture(t);
  const { booking } = await bookStandingCall({ ...input, store });
  const result = callBookingResult(booking);
  assert.deepEqual(result.confirmed, ['did:plc:person0']);
  assert.deepEqual(result.needsConfirm, ['did:plc:person1', 'did:plc:person2', 'did:plc:person3']);
  const own = callParticipantView(booking, 'did:plc:person1');
  assert.equal(own.state, 'pending');
  assert.equal(own.canDownload, false);
  assert.equal(own.participants, undefined);
  assert.equal(own.needsConfirm, undefined);
  assert.throws(() => callParticipantView(booking, 'did:plc:stranger'), { status: 404 });
});

test('private choices survive reload; accept/decline is participant-only, terminal and idempotent', async (t) => {
  const { store, dir } = await fixture(t);
  const { booking } = await bookStandingCall({ ...input, store });
  await assert.rejects(store.decide(booking.id, 'did:plc:stranger', 'accept'), { status: 404 });
  await assert.rejects(store.decide(booking.id, 'did:plc:person1', 'auto'), { status: 400 });
  const accepted = await store.decide(booking.id, 'did:plc:person1', 'accept');
  assert.equal(callParticipantView(accepted, 'did:plc:person1').canDownload, true);
  assert.deepEqual(await store.decide(booking.id, 'did:plc:person1', 'accept'), accepted);
  await assert.rejects(store.decide(booking.id, 'did:plc:person1', 'decline'), { status: 409 });
  await store.decide(booking.id, 'did:plc:person2', 'decline');
  const reloaded = createCallBookingStore({ dataDir: dir, now: () => NOW });
  const replay = callBookingResult(await reloaded.find('service', input.idempotencyKey));
  assert.equal(replay.bookingId, booking.id);
  assert.equal(replay.slot, input.slot);
  assert.deepEqual(replay.confirmed, ['did:plc:person0', 'did:plc:person1']);
  assert.deepEqual(replay.declined, ['did:plc:person2']);
  assert.deepEqual(replay.needsConfirm, ['did:plc:person3']);
  const disk = JSON.parse(await readFile(path.join(dir, 'private-call-bookings.json'), 'utf8'));
  assert.equal(disk[0].participants['did:plc:person2'].state, 'declined');
});

test('concurrent creation/replay names one resource; different callers and keyless calls cannot collide', async (t) => {
  const { store } = await fixture(t);
  const [a, b] = await Promise.all([bookStandingCall({ ...input, store }), bookStandingCall({ ...input, store })]);
  assert.equal(a.booking.id, b.booking.id);
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  await assert.rejects(bookStandingCall({ ...input, store,
    scope: { type: 'ca-community', value: 'another-community' },
  }), { status: 409 });
  const other = await bookStandingCall({ ...input, caller: 'did:did:plc:owner', store });
  assert.notEqual(other.booking.id, a.booking.id);
  const firstKeyless = await bookStandingCall({ ...input, idempotencyKey: undefined, store });
  const secondKeyless = await bookStandingCall({ ...input, idempotencyKey: undefined, store });
  assert.notEqual(firstKeyless.booking.id, secondKeyless.booking.id);
});

test('parallel decisions cannot overwrite each other', async (t) => {
  const { store } = await fixture(t);
  const { booking } = await bookStandingCall({ ...input, store });
  await Promise.all([
    store.decide(booking.id, 'did:plc:person1', 'accept'),
    store.decide(booking.id, 'did:plc:person2', 'decline'),
  ]);
  const result = callBookingResult(await store.get(booking.id));
  assert.equal(result.confirmed.length, 2);
  assert.equal(result.declined.length, 1);
});

test('all-confirmation groups have a selected time, but nobody is confirmed', async (t) => {
  const { store } = await fixture(t);
  const { booking } = await bookStandingCall({ ...input, store,
    members: members.map((m) => ({ ...m, record: { value: { trust: 'confirm' } } })),
  });
  const result = callBookingResult(booking);
  assert.deepEqual(result.confirmed, []);
  assert.equal(result.needsConfirm.length, 4);
});

test('passed times cannot be newly accepted and corrupt storage fails closed', async (t) => {
  const { store, dir } = await fixture(t);
  const { booking } = await bookStandingCall({ ...input, slot: '2029-12-31T14:00', store });
  await assert.rejects(store.decide(booking.id, 'did:plc:person1', 'accept'), { status: 410 });
  await writeFile(path.join(dir, 'private-call-bookings.json'), 'not-json');
  const broken = createCallBookingStore({ dataDir: dir, now: () => NOW });
  await assert.rejects(broken.find('service', input.idempotencyKey), { status: 503 });
});

test('failed durable creation does not publish an in-memory phantom booking', async (t) => {
  const { dir, store } = await fixture(t);
  // Load valid empty storage first, then force the atomic replacement to fail.
  // A parent that is a file reports ENOENT on Windows but ENOTDIR on Linux,
  // which tests failed loading rather than failed durable creation there.
  assert.equal(await store.find('service', input.idempotencyKey), undefined);
  await mkdir(path.join(dir, 'private-call-bookings.json'));
  await assert.rejects(bookStandingCall({ ...input, store }), { status: 503 });
  assert.equal(await store.find('service', input.idempotencyKey), undefined);
});
