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

    assert.equal(result.length, 2); // 14:00 and 15:00 starts
    assert.equal(result[0].slot, '2026-07-21T14:00');
    assert.equal(result[0].count, 2);
    assert.deepEqual([...result[0].participants].sort(), ['did:plc:alice', 'did:plc:bob']);
    assert.equal(result[1].slot, '2026-07-21T15:00');
    assert.equal(result[1].count, 2);
  });

  it('(b) cross-tz: Berlin 14:00-16:00 and a NY window covering the same absolute instant overlap', () => {
    // Berlin (CEST, UTC+2) 14:00 & 15:00 starts -> 12:00 & 13:00 UTC.
    // NY (EDT, UTC-4) 08:00-10:00 -> 08:00 & 09:00 starts -> 12:00 & 13:00 UTC.
    const members = [
      member('did:plc:berliner', { startTime: '14:00', endTime: '16:00', timezone: 'Europe/Berlin' }),
      member('did:plc:newyorker', { startTime: '08:00', endTime: '10:00', timezone: 'America/New_York' }),
    ];

    const result = bestCallSlots({ members, window: TUE, durationMinutes: 60 });

    assert.equal(result.length, 2);
    const bySlot = Object.fromEntries(result.map((r) => [r.slot, r]));
    assert.ok(bySlot['2026-07-21T12:00'], 'expected shared UTC key 12:00');
    assert.equal(bySlot['2026-07-21T12:00'].count, 2);
    assert.deepEqual(
      [...bySlot['2026-07-21T12:00'].participants].sort(),
      ['did:plc:berliner', 'did:plc:newyorker']
    );
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

  it('(d) duration-aligned starts: 14:00-18:00 with 60-min duration -> 14/15/16/17, not 17:30', () => {
    const members = [
      member('did:plc:alice', { startTime: '14:00', endTime: '18:00', timezone: 'UTC' }),
      member('did:plc:bob', { startTime: '14:00', endTime: '18:00', timezone: 'UTC' }),
    ];

    const result = bestCallSlots({ members, window: TUE, durationMinutes: 60 });

    const slots = result.map((r) => r.slot).sort();
    assert.deepEqual(slots, [
      '2026-07-21T14:00',
      '2026-07-21T15:00',
      '2026-07-21T16:00',
      '2026-07-21T17:00',
    ]);
    assert.ok(!slots.includes('2026-07-21T17:30'), 'must not emit a non-aligned 17:30 start');
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
