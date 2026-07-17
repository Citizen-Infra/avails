import { test } from 'node:test';
import assert from 'node:assert';
import { validateAvailability } from '../src/lib/availabilityValidate.js';

test('accepts a minimal valid record', () => {
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: 'at://did:plc:x/app.bsky.graph.list/abc' },
    pattern: { weekly: [{ day: 2, startTime: '14:00', endTime: '18:00' }] },
    timezone: 'Europe/Berlin',
    trust: 'confirm',
  });
  assert.equal(r.valid, true);
  assert.equal(r.value.trust, 'confirm');
});

test('rejects a bad day index', () => {
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: 'at://x/app.bsky.graph.list/abc' },
    pattern: { weekly: [{ day: 9, startTime: '14:00', endTime: '18:00' }] },
    timezone: 'Europe/Berlin', trust: 'confirm',
  });
  assert.equal(r.valid, false);
});

test('rejects unknown trust value and strips unknown fields', () => {
  const bad = validateAvailability({ scope:{type:'atproto-list',value:'at://x/app.bsky.graph.list/a'}, pattern:{weekly:[{day:1,startTime:'09:00',endTime:'12:00'}]}, timezone:'UTC', trust:'always' });
  assert.equal(bad.valid, false);
  const ok = validateAvailability({ scope:{type:'atproto-list',value:'at://x/app.bsky.graph.list/a'}, pattern:{weekly:[{day:1,startTime:'09:00',endTime:'12:00'}]}, timezone:'UTC', trust:'auto', injected:'evil' });
  assert.equal(ok.valid, true);
  assert.equal(ok.value.injected, undefined);
});

test('rejects ca-community scope in Phase 1', () => {
  const r = validateAvailability({
    scope: { type: 'ca-community', value: 'community-123' },
    pattern: { weekly: [{ day: 1, startTime: '09:00', endTime: '12:00' }] },
    timezone: 'UTC',
    trust: 'confirm',
  });
  assert.equal(r.valid, false);
  assert.match(r.error, /Phase 1/);
});

test('rejects startTime >= endTime', () => {
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: 'at://x/app.bsky.graph.list/a' },
    pattern: { weekly: [{ day: 1, startTime: '18:00', endTime: '14:00' }] },
    timezone: 'UTC',
    trust: 'confirm',
  });
  assert.equal(r.valid, false);
});

test('rejects malformed HH:MM without leading zero', () => {
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: 'at://x/app.bsky.graph.list/a' },
    pattern: { weekly: [{ day: 1, startTime: '9:00', endTime: '12:00' }] },
    timezone: 'UTC',
    trust: 'confirm',
  });
  assert.equal(r.valid, false);
});

test('rejects out-of-range HH:MM (25:00)', () => {
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: 'at://x/app.bsky.graph.list/a' },
    pattern: { weekly: [{ day: 1, startTime: '09:00', endTime: '25:00' }] },
    timezone: 'UTC',
    trust: 'confirm',
  });
  assert.equal(r.valid, false);
});

test('accepts supplied valid ISO validUntil and passes it through', () => {
  const validIso = '2026-12-31T23:59:59.000Z';
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: 'at://x/app.bsky.graph.list/a' },
    pattern: { weekly: [{ day: 1, startTime: '09:00', endTime: '12:00' }] },
    timezone: 'UTC',
    trust: 'confirm',
    validUntil: validIso,
  });
  assert.equal(r.valid, true);
  assert.equal(r.value.validUntil, validIso);
});

test('rejects non-ISO validUntil string', () => {
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: 'at://x/app.bsky.graph.list/a' },
    pattern: { weekly: [{ day: 1, startTime: '09:00', endTime: '12:00' }] },
    timezone: 'UTC',
    trust: 'confirm',
    validUntil: 'not-a-date',
  });
  assert.equal(r.valid, false);
  assert.match(r.error, /ISO datetime/);
});

test('omitted validUntil defaults to roughly 8 weeks out', () => {
  const before = Date.now();
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: 'at://x/app.bsky.graph.list/a' },
    pattern: { weekly: [{ day: 1, startTime: '09:00', endTime: '12:00' }] },
    timezone: 'UTC',
    trust: 'confirm',
  });
  const after = Date.now();
  assert.equal(r.valid, true);
  const expectedMin = new Date(before + 55 * 24 * 3600 * 1000);
  const expectedMax = new Date(after + 57 * 24 * 3600 * 1000);
  const actual = new Date(r.value.validUntil);
  assert.ok(actual >= expectedMin && actual <= expectedMax, `validUntil ${r.value.validUntil} should be between ${expectedMin.toISOString()} and ${expectedMax.toISOString()}`);
});

test('rejects scope.value exceeding 512 chars', () => {
  const longValue = 'at://x/app.bsky.graph.list/' + 'a'.repeat(513);
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: longValue },
    pattern: { weekly: [{ day: 1, startTime: '09:00', endTime: '12:00' }] },
    timezone: 'UTC',
    trust: 'confirm',
  });
  assert.equal(r.valid, false);
  assert.match(r.error, /512/);
});

test('rejects timezone exceeding 64 chars', () => {
  const longTz = 'A'.repeat(65);
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: 'at://x/app.bsky.graph.list/a' },
    pattern: { weekly: [{ day: 1, startTime: '09:00', endTime: '12:00' }] },
    timezone: longTz,
    trust: 'confirm',
  });
  assert.equal(r.valid, false);
  assert.match(r.error, /64/);
});

// --- #106 fast-follows: edge cases the PR #104 reviews flagged as untested ---

function baseBody(extra = {}) {
  return {
    scope: { type: 'atproto-list', value: 'at://did:plc:x/app.bsky.graph.list/abc' },
    pattern: { weekly: [{ day: 2, startTime: '14:00', endTime: '18:00' }] },
    timezone: 'Europe/Berlin',
    trust: 'confirm',
    ...extra,
  };
}

test('rejects a window whose startTime equals its endTime', () => {
  const r = validateAvailability(baseBody({
    pattern: { weekly: [{ day: 2, startTime: '14:00', endTime: '14:00' }] },
  }));
  assert.equal(r.valid, false);
});

test('rejects a non-string validUntil', () => {
  for (const bad of [123, {}, [], true, null]) {
    const r = validateAvailability(baseBody({ validUntil: bad }));
    assert.equal(r.valid, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('accepts a date-only validUntil — unambiguously UTC per the JS spec', () => {
  assert.equal(validateAvailability(baseBody({ validUntil: '2026-12-31' })).valid, true);
});

test('accepts offset-qualified ISO datetimes', () => {
  for (const good of ['2026-12-31T00:00:00Z', '2026-09-11T00:00:00.000Z', '2026-12-31T01:00:00+05:30']) {
    assert.equal(validateAvailability(baseBody({ validUntil: good })).valid, true, `expected ${good} accepted`);
  }
});

test('rejects a datetime with no offset — it would mean a different instant per host', () => {
  // new Date('2026-12-31T00:00:00') is parsed in the SERVER's local zone, so
  // the stored instant would depend on which machine handled the request.
  assert.equal(validateAvailability(baseBody({ validUntil: '2026-12-31T00:00:00' })).valid, false);
});

test('rejects non-ISO formats that Date happens to parse', () => {
  // The function is named isValidISODateTime and its error says "ISO", but it
  // accepted anything Date could parse — including a bare year.
  for (const bad of ['12/31/2026', 'Dec 31 2026', '2026', '2026-13-01', '2026-12-32']) {
    assert.equal(validateAvailability(baseBody({ validUntil: bad })).valid, false, `expected ${bad} rejected`);
  }
});

test('rejects an impossible calendar date instead of silently rolling it over', () => {
  // new Date('2026-02-31') yields 2026-03-03 — a user typing Feb 31 would get
  // an expiry three days later than anything they asked for.
  assert.equal(validateAvailability(baseBody({ validUntil: '2026-02-31' })).valid, false);
});

test('handles leap years when validating the calendar date', () => {
  assert.equal(validateAvailability(baseBody({ validUntil: '2028-02-29' })).valid, true, '2028 is a leap year');
  assert.equal(validateAvailability(baseBody({ validUntil: '2026-02-29' })).valid, false, '2026 is not');
});
