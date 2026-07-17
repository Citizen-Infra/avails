/**
 * Tests for the schedule_call MCP tool (Task 8): books a call directly from
 * members' standing availability, with NO poll created. Mocks Task 6
 * (resolveListAvailability), Task 7 (bestCallSlots), and email — this test
 * is about schedule_call's own orchestration/trust-split/fallback logic,
 * not those already-tested modules.
 *
 * Requires --experimental-test-module-mocks (mock.module below), so this
 * file is registered in the second (mock) group in package.json's test
 * script, alongside responses.test.js / availability.route.test.js.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const LIST_URI = 'at://did:plc:creator/app.bsky.graph.list/thelist';

function member(did, trust, { timezone = 'UTC' } = {}) {
  return {
    did,
    record: {
      uri: `at://${did}/chat.avails.scheduling.availability/r1`,
      cid: 'cid-r1',
      value: {
        scope: { type: 'atproto-list', value: LIST_URI },
        pattern: { weekly: [{ day: 2, startTime: '14:00', endTime: '16:00' }] },
        timezone,
        trust,
      },
    },
  };
}

// Mutable hooks the mocked modules call through to, so each test can swap
// behaviour without re-registering mock.module (which must run before the
// module-under-test is imported, i.e. once, at the top of the file).
let resolveListAvailabilityImpl;
let bestCallSlotsImpl;
let sendEmailCalls;

mock.module('../src/mcp/listMembers.js', {
  namedExports: {
    resolveListAvailability: (...args) => resolveListAvailabilityImpl(...args),
  },
});

mock.module('../src/mcp/availabilityOverlap.js', {
  namedExports: {
    bestCallSlots: (...args) => bestCallSlotsImpl(...args),
  },
});

mock.module('../src/lib/email.js', {
  namedExports: {
    sendEmail: async (opts) => {
      sendEmailCalls.push(opts);
      return { id: 'mock-email' };
    },
  },
});

// schedule_call must create NO poll record and make NO PDS/network calls at
// all in its success path (resolveListAvailability/bestCallSlots/sendEmail
// are fully mocked above, so a real implementation makes zero fetch calls).
// Fail loudly if anything reaches fetch — this is the "no poll createRecord"
// assertion, made structural rather than string-matched.
let fetchCalls;
globalThis.fetch = async (url, opts) => {
  fetchCalls.push({ url: String(url), opts });
  throw new Error(`Unexpected fetch() call in schedule_call test: ${url}`);
};

const { callTool } = await import('../src/mcp/tools.js');

function resetHooks() {
  sendEmailCalls = [];
  fetchCalls = [];
  resolveListAvailabilityImpl = async () => {
    throw new Error('resolveListAvailability should not be called in this test');
  };
  bestCallSlotsImpl = () => {
    throw new Error('bestCallSlots should not be called in this test');
  };
}

const WINDOW = { start: '2026-07-21', end: '2026-07-21' };

describe('schedule_call', () => {
  it('(a) 3 members all trust:auto with a clear top slot -> books, all auto-booked, no confirm needed, no poll record created', async () => {
    resetHooks();
    const alice = member('did:plc:alice', 'auto');
    const bob = member('did:plc:bob', 'auto');
    const carol = member('did:plc:carol', 'auto');
    resolveListAvailabilityImpl = async (listUri) => {
      assert.equal(listUri, LIST_URI);
      return [alice, bob, carol];
    };
    bestCallSlotsImpl = ({ members, window, durationMinutes }) => {
      assert.equal(members.length, 3);
      assert.deepEqual(window, WINDOW);
      assert.equal(durationMinutes, 60);
      return [
        { slot: '2026-07-21T14:00', participants: ['did:plc:alice', 'did:plc:bob', 'did:plc:carol'], count: 3 },
        { slot: '2026-07-21T15:00', participants: ['did:plc:alice', 'did:plc:bob'], count: 2 },
      ];
    };

    const raw = await callTool('schedule_call', {
      scope: { type: 'atproto-list', value: LIST_URI },
      durationMinutes: 60,
      window: WINDOW,
      title: 'Weekly sync',
    }, null);
    const result = JSON.parse(raw);

    assert.equal(result.booked, true);
    assert.equal(result.slot, '2026-07-21T14:00');
    assert.equal(result.durationMinutes, 60);
    assert.equal(result.title, 'Weekly sync');
    assert.deepEqual([...result.participants].sort(), ['did:plc:alice', 'did:plc:bob', 'did:plc:carol']);
    assert.deepEqual([...result.autoBooked].sort(), ['did:plc:alice', 'did:plc:bob', 'did:plc:carol']);
    assert.deepEqual(result.needsConfirm, []);
    assert.equal(result.coverage.withRecords, 3);
    assert.equal(result.coverage.membersFree, 3);

    // No poll createRecord (or any PDS/network call) anywhere in this path.
    assert.deepEqual(fetchCalls, []);
    // No emails — none of the mocked records carry an email address.
    assert.deepEqual(sendEmailCalls, []);
  });

  it('(b) thin coverage: only 1 member has a standing-availability record -> falls back without calling bestCallSlots', async () => {
    resetHooks();
    resolveListAvailabilityImpl = async () => [member('did:plc:alice', 'auto')];
    // bestCallSlotsImpl left as the "should not be called" throw from resetHooks.

    const raw = await callTool('schedule_call', {
      scope: { type: 'atproto-list', value: LIST_URI },
      durationMinutes: 60,
      window: WINDOW,
      title: 'Weekly sync',
    }, null);
    const result = JSON.parse(raw);

    assert.equal(result.booked, false);
    assert.equal(result.fallback, 'create_poll');
    assert.ok(result.reason && result.reason.length > 0);
    assert.deepEqual(fetchCalls, []);
    assert.deepEqual(sendEmailCalls, []);
  });

  it('(c) no real overlap: top slot count < 2 -> falls back, does not book', async () => {
    resetHooks();
    resolveListAvailabilityImpl = async () => [member('did:plc:alice', 'auto'), member('did:plc:bob', 'auto')];
    bestCallSlotsImpl = () => [
      { slot: '2026-07-21T14:00', participants: ['did:plc:alice'], count: 1 },
    ];

    const raw = await callTool('schedule_call', {
      scope: { type: 'atproto-list', value: LIST_URI },
      durationMinutes: 60,
      window: WINDOW,
      title: 'Weekly sync',
    }, null);
    const result = JSON.parse(raw);

    assert.equal(result.booked, false);
    assert.equal(result.fallback, 'create_poll');
    assert.ok(result.reason && result.reason.length > 0);
    assert.deepEqual(fetchCalls, []);
  });

  it('(d) trust split: 2 auto + 1 confirm all free at the top slot -> books, splits correctly', async () => {
    resetHooks();
    const alice = member('did:plc:alice', 'auto');
    const bob = member('did:plc:bob', 'auto');
    const carol = member('did:plc:carol', 'confirm');
    resolveListAvailabilityImpl = async () => [alice, bob, carol];
    bestCallSlotsImpl = () => [
      { slot: '2026-07-21T14:00', participants: ['did:plc:alice', 'did:plc:bob', 'did:plc:carol'], count: 3 },
    ];

    const raw = await callTool('schedule_call', {
      scope: { type: 'atproto-list', value: LIST_URI },
      durationMinutes: 30,
      window: WINDOW,
      title: 'Planning call',
    }, null);
    const result = JSON.parse(raw);

    assert.equal(result.booked, true);
    assert.deepEqual([...result.autoBooked].sort(), ['did:plc:alice', 'did:plc:bob']);
    assert.deepEqual(result.needsConfirm, ['did:plc:carol']);
    // Booking happens regardless of trust mix — support decides whether,
    // records decide when; trust only decides who's auto vs needs-confirm.
    assert.equal(result.coverage.membersFree, 3);
    assert.deepEqual(fetchCalls, []);
  });

  it('(e) a ca-community scope is rejected with a clear Phase 1 error, before touching resolveListAvailability', async () => {
    resetHooks();
    // resolveListAvailabilityImpl left as the "should not be called" throw.

    await assert.rejects(
      () => callTool('schedule_call', {
        scope: { type: 'ca-community', value: 'some-community-id' },
        durationMinutes: 60,
        window: WINDOW,
        title: 'Weekly sync',
      }, null),
      /Phase 1/
    );
    assert.deepEqual(fetchCalls, []);
  });
});
