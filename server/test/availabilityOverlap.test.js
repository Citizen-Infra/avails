import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { bestCallSlots } from '../src/mcp/availabilityOverlap.js';

// 2026-07-21 is a Tuesday (day 2 in the 0=Sun..6=Sat convention used by
// pattern.weekly). Window spans just that one date unless noted otherwise.
const TUE = { start: '2026-07-21', end: '2026-07-21' };

function member(did, { day = 2, startTime, endTime, timezone = 'UTC' }) {
  return {
    did,
    record: {
      uri: `at://${did}/chat.avails.scheduling.availability/r1`,
      cid: 'cid-r1',
      value: {
        scope: { type: 'atproto-list', value: 'at://did:plc:creator/app.bsky.graph.list/abc' },
        pattern: { weekly: [{ day, startTime, endTime }] },
        timezone,
        trust: 'confirm',
      },
    },
  };
}

describe('bestCallSlots', () => {
  it('(a) two members in the same tz with an overlapping window -> top slot count 2 at the correct UTC key', () => {
    const members = [
      member('did:plc:alice', { startTime: '14:00', endTime: '16:00', timezone: 'UTC' }),
      member('did:plc:bob', { startTime: '14:00', endTime: '16:00', timezone: 'UTC' }),
    ];

    const result = bestCallSlots({ members, window: TUE, durationMinutes: 60 });

    // Grid-anchored enumeration (Finding 1 fix) surfaces every 30-min
    // position where a 60-min call fits within the 2-hour window -- 14:00,
    // 14:30, and 15:00 -- not just the window's own hour-aligned starts.
    assert.equal(result.length, 3);
    assert.equal(result[0].slot, '2026-07-21T14:00');
    assert.equal(result[0].count, 2);
    assert.deepEqual([...result[0].participants].sort(), ['did:plc:alice', 'did:plc:bob']);
    assert.equal(result[1].slot, '2026-07-21T14:30');
    assert.equal(result[1].count, 2);
    assert.equal(result[2].slot, '2026-07-21T15:00');
    assert.equal(result[2].count, 2);
  });

  it('(b) cross-tz: Berlin 14:00-16:00 and a NY window covering the same absolute instant overlap', () => {
    // Berlin (CEST, UTC+2) 14:00 & 15:00 starts -> 12:00 & 13:00 UTC.
    // NY (EDT, UTC-4) 08:00-10:00 -> 08:00 & 09:00 starts -> 12:00 & 13:00 UTC.
    const members = [
      member('did:plc:berliner', { startTime: '14:00', endTime: '16:00', timezone: 'Europe/Berlin' }),
      member('did:plc:newyorker', { startTime: '08:00', endTime: '10:00', timezone: 'America/New_York' }),
    ];

    const result = bestCallSlots({ members, window: TUE, durationMinutes: 60 });

    // Both windows are 2 hours -- grid-anchored enumeration finds 3 shared
    // 30-min-spaced starts (12:00/12:30/13:00 UTC), not just 2.
    assert.equal(result.length, 3);
    const bySlot = Object.fromEntries(result.map((r) => [r.slot, r]));
    assert.ok(bySlot['2026-07-21T12:00'], 'expected shared UTC key 12:00');
    assert.equal(bySlot['2026-07-21T12:00'].count, 2);
    assert.deepEqual(
      [...bySlot['2026-07-21T12:00'].participants].sort(),
      ['did:plc:berliner', 'did:plc:newyorker']
    );
    assert.ok(bySlot['2026-07-21T12:30'], 'expected shared UTC key 12:30');
    assert.equal(bySlot['2026-07-21T12:30'].count, 2);
    assert.ok(bySlot['2026-07-21T13:00'], 'expected shared UTC key 13:00');
    assert.equal(bySlot['2026-07-21T13:00'].count, 2);
  });

  it('(b2) non-overlapping absolute time: same wall-clock hours in different tzs do NOT overlap', () => {
    // Both members use local 14:00-15:00, but Berlin (UTC+2) -> 12:00 UTC
    // while NY (UTC-4) -> 18:00 UTC. Different instants, no overlap.
    const members = [
      member('did:plc:berliner', { startTime: '14:00', endTime: '15:00', timezone: 'Europe/Berlin' }),
      member('did:plc:newyorker', { startTime: '14:00', endTime: '15:00', timezone: 'America/New_York' }),
    ];

    const result = bestCallSlots({ members, window: TUE, durationMinutes: 60 });

    assert.equal(result.length, 2);
    for (const r of result) {
      assert.equal(r.count, 1);
    }
    const slots = result.map((r) => r.slot).sort();
    assert.deepEqual(slots, ['2026-07-21T12:00', '2026-07-21T18:00']);
  });

  it('(c) a window shorter than durationMinutes yields no slots', () => {
    const members = [
      member('did:plc:alice', { startTime: '14:00', endTime: '14:30', timezone: 'UTC' }),
    ];

    const result = bestCallSlots({ members, window: TUE, durationMinutes: 60 });

    assert.deepEqual(result, []);
  });

  it('(d) grid-aligned starts: 14:00-18:00 with 60-min duration -> every 30-min position that fits, not one that overruns the window', () => {
    const members = [
      member('did:plc:alice', { startTime: '14:00', endTime: '18:00', timezone: 'UTC' }),
      member('did:plc:bob', { startTime: '14:00', endTime: '18:00', timezone: 'UTC' }),
    ];

    const result = bestCallSlots({ members, window: TUE, durationMinutes: 60 });

    const slots = result.map((r) => r.slot).sort();
    // Grid-anchored enumeration (Finding 1 fix) surfaces every 30-min start
    // within the 4-hour window where a 60-min call still fits -- 7 starts,
    // not just the window's own hour-aligned starts (14/15/16/17).
    assert.deepEqual(slots, [
      '2026-07-21T14:00',
      '2026-07-21T14:30',
      '2026-07-21T15:00',
      '2026-07-21T15:30',
      '2026-07-21T16:00',
      '2026-07-21T16:30',
      '2026-07-21T17:00',
    ]);
    assert.ok(
      !slots.includes('2026-07-21T17:30'),
      'must not emit a start that would run past the window end (17:30 + 60min = 18:30 > 18:00)'
    );
  });

  it('reads availability fields from record.value, not record directly', () => {
    // Sanity guard against the Task-6 footgun: members carry the FULL
    // listRecords item, so pattern/timezone live under record.value.
    const bareRecord = {
      did: 'did:plc:flatshape',
      record: {
        // No .value wrapper -- simulates a caller mistakenly passing an
        // already-unwrapped shape. Expander must find nothing usable.
        pattern: { weekly: [{ day: 2, startTime: '14:00', endTime: '16:00' }] },
        timezone: 'UTC',
      },
    };

    const result = bestCallSlots({ members: [bareRecord], window: TUE, durationMinutes: 60 });
    assert.deepEqual(result, []);
  });

  it('(e) same-tz OFFSET windows: A 14:00-16:00 and B 14:30-16:30 (both Europe/Berlin) share canonical UTC starts', () => {
    // The bug this guards: expandMemberSlots used to step durationMinutes
    // from EACH member's own window start, so A's candidates (14:00,15:00)
    // and B's (14:30,15:30) never shared a key even though a 60-min call
    // plainly fits both at 14:30 or 15:00. Anchoring every member to the
    // same canonical UTC 30-min grid fixes it.
    const members = [
      member('did:plc:alice', { startTime: '14:00', endTime: '16:00', timezone: 'Europe/Berlin' }),
      member('did:plc:bob', { startTime: '14:30', endTime: '16:30', timezone: 'Europe/Berlin' }),
    ];

    const result = bestCallSlots({ members, window: TUE, durationMinutes: 60 });

    const overlapping = result.filter((r) => r.count === 2);
    assert.ok(overlapping.length >= 1, 'expected at least one shared canonical UTC start');
    for (const r of overlapping) {
      assert.deepEqual([...r.participants].sort(), ['did:plc:alice', 'did:plc:bob']);
    }
  });

  it('(f) half-hour-offset tz: Asia/Kolkata (+5:30) member overlaps an Etc/UTC member free at the same absolute instants', () => {
    // Kolkata is UTC+5:30 -- a member free 19:30-21:30 IST is free at the
    // exact same absolute instants as a UTC member free 14:00-16:00 (14:00
    // UTC = 19:30 IST). Half-hour-offset zones are exactly the case the
    // review flagged as compounding the offset-window bug.
    const members = [
      member('did:plc:kolkata', { startTime: '19:30', endTime: '21:30', timezone: 'Asia/Kolkata' }),
      member('did:plc:utc', { startTime: '14:00', endTime: '16:00', timezone: 'Etc/UTC' }),
    ];

    const result = bestCallSlots({ members, window: TUE, durationMinutes: 60 });

    const overlapping = result.filter((r) => r.count === 2);
    assert.ok(overlapping.length >= 1, 'expected at least one shared canonical UTC start');
    for (const r of overlapping) {
      assert.deepEqual([...r.participants].sort(), ['did:plc:kolkata', 'did:plc:utc']);
    }
  });

  it('a multi-day window only expands dates whose weekday matches pattern.day', () => {
    // Mon 2026-07-20 .. Wed 2026-07-22; pattern day=2 (Tue) should only
    // produce slots for 2026-07-21.
    const window = { start: '2026-07-20', end: '2026-07-22' };
    const members = [
      member('did:plc:alice', { startTime: '14:00', endTime: '15:00', timezone: 'UTC' }),
    ];

    const result = bestCallSlots({ members, window, durationMinutes: 60 });

    assert.deepEqual(result.map((r) => r.slot), ['2026-07-21T14:00']);
  });
});
