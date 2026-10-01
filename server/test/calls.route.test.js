import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

// Only identity verification is an adapter. The production router, validators,
// private store, permission checks, and actual ICS generator run unchanged.
mock.module('../src/middleware/auth.js', { namedExports: {
  requireAuth: (req, res, next) => {
    if (!req.get('x-test-did')) return res.status(401).json({ error: 'Not authenticated' });
    req.userDid = req.get('x-test-did');
    next();
  },
} });
process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), 'avails-call-route-'));
process.env.CLIENT_URL = 'https://avails.test';
process.env.AVAILS_SERVICE_SECRET = 'route-test-only';
after(() => rm(process.env.DATA_DIR, { recursive: true, force: true }));
const { default: calls } = await import('../src/routes/calls.js');
const { callBookingStore, bookStandingCall } = await import('../src/lib/callBookings.js');

async function fixture(t, caller = 'service') {
  const { booking } = await bookStandingCall({
    members: [
      { did: 'did:plc:auto', record: { value: { trust: 'auto' } } },
      { did: 'did:plc:pending', record: { value: { trust: 'confirm' } } },
    ],
    participants: ['did:plc:auto', 'did:plc:pending'], title: 'Selected call',
    slot: '2030-01-08T14:00', durationMinutes: 30, caller,
    scope: { type: 'ca-community', value: 'test' }, coverage: { membersFree: 2, withRecords: 2 },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/calls', calls);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/calls/${booking.id}`;
  const request = (suffix = '', did, options = {}) => fetch(base + suffix, {
    ...options, headers: { ...(did && { 'x-test-did': did }), ...options.headers },
  });
  return { booking, request };
}

test('anonymous/other DIDs cannot read a call, and participants see only their own state', async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request()).status, 401);
  const stranger = await request('', 'did:plc:stranger');
  assert.equal(stranger.status, 404);
  assert.deepEqual(await stranger.json(), { error: 'Call not found' });
  const own = await request('', 'did:plc:pending');
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('cache-control'), 'private, no-store');
  const body = await own.json();
  assert.equal(body.state, 'pending');
  assert.equal(body.participants, undefined);
  assert.equal(body.needsConfirm, undefined);
});

test('only a validated, same-origin decision can change the authenticated participant', async (t) => {
  const { booking, request } = await fixture(t);
  const post = (body, origin = 'https://avails.test') => request('/decision', 'did:plc:pending', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  });
  assert.equal((await post({ decision: 'accept', did: 'did:plc:auto' })).status, 400);
  assert.equal((await post({ decision: 'accept' }, 'https://attacker.test')).status, 403);
  assert.equal((await post({ decision: 'auto' })).status, 400);
  assert.equal((await post({ decision: 'accept' })).status, 200);
  assert.equal((await post({ decision: 'accept' })).status, 200, 'same decision is a safe retry');
  assert.equal((await post({ decision: 'decline' })).status, 409);
  assert.equal((await callBookingStore.get(booking.id)).participants['did:plc:auto'].state, 'accepted');
});

test('ICS is unavailable before consent; accepted downloads have stable UIDs and no roster', async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request('/calendar.ics')).status, 401);
  assert.equal((await request('/calendar.ics', 'did:plc:stranger')).status, 404);
  assert.equal((await request('/calendar.ics', 'did:plc:pending')).status, 403);
  await request('/decision', 'did:plc:pending', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'accept' }),
  });
  const first = await request('/calendar.ics', 'did:plc:pending');
  assert.equal(first.status, 200);
  assert.match(first.headers.get('content-type'), /text\/calendar/);
  const ics = await first.text();
  const repeated = await (await request('/calendar.ics', 'did:plc:auto')).text();
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART:20300108T140000Z/);
  assert.doesNotMatch(ics, /did:plc:auto|did:plc:pending|Participants:/);
  assert.equal(ics.match(/^UID:(.+)$/m)[1], repeated.match(/^UID:(.+)$/m)[1]);
});

test('a decline cannot obtain an invite or change another participant', async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request('/decision', 'did:plc:pending', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'decline' }),
  })).status, 200);
  assert.equal((await request('/calendar.ics', 'did:plc:pending')).status, 403);
});

test('distinct bookings at the same selected time have distinct calendar identities', async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  const a = await (await first.request('/calendar.ics', 'did:plc:auto')).text();
  const b = await (await second.request('/calendar.ics', 'did:plc:auto')).text();
  assert.notEqual(a.match(/^UID:(.+)$/m)[1], b.match(/^UID:(.+)$/m)[1]);
});

test('only the service grant reads its own aggregate handoff', async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request('/handoff', 'did:plc:auto')).status, 401);
  const response = await request('/handoff', null, { headers: { Authorization: 'Bearer route-test-only' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).needsConfirm.length, 1);
  const individual = await fixture(t, 'did:did:plc:owner');
  assert.equal((await individual.request('/handoff', null, {
    headers: { Authorization: 'Bearer route-test-only' },
  })).status, 404);
});
