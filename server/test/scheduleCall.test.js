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

// schedule_call is gated (#149) — it books calls and emails the people it books.
// These orchestration tests are not about the gate, so they run as the service
// caller (community-admin's trigger). The gate itself is exercised below.
const SERVICE = { service: 'community-admin', did: null, handle: null, oauthSession: null };
const OWNER = { service: null, did: 'did:plc:creator', handle: 'creator.test', oauthSession: null };
const STRANGER = { service: null, did: 'did:plc:someoneelse', handle: 'nosy.test', oauthSession: null };

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
let resolveAvailabilityForDidsImpl;
let bestCallSlotsImpl;
let sendEmailCalls;

mock.module('../src/mcp/listMembers.js', {
  namedExports: {
    resolveListAvailability: (...args) => resolveListAvailabilityImpl(...args),
    resolveAvailabilityForDids: (...args) => resolveAvailabilityForDidsImpl(...args),
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
  resolveAvailabilityForDidsImpl = async () => {
    throw new Error('resolveAvailabilityForDids should not be called in this test');
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
    }, SERVICE);
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
    }, SERVICE);
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
    }, SERVICE);
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
    }, SERVICE);
    const result = JSON.parse(raw);

    assert.equal(result.booked, true);
    assert.deepEqual([...result.autoBooked].sort(), ['did:plc:alice', 'did:plc:bob']);
    assert.deepEqual(result.needsConfirm, ['did:plc:carol']);
    // Booking happens regardless of trust mix — support decides whether,
    // records decide when; trust only decides who's auto vs needs-confirm.
    assert.equal(result.coverage.membersFree, 3);
    assert.deepEqual(fetchCalls, []);
  });

  it('(f) an object scope with no type is rejected — the tool schema declares type required', async () => {
    resetHooks();
    // TOOL_DEFINITIONS says required: ['type','value'] for the object form, so
    // defaulting a missing type silently contradicted the published contract:
    // a mistyped ca-community scope went down the list path and failed later
    // with an unrelated error about the URI shape.
    await assert.rejects(
      () => callTool('schedule_call', {
        scope: { value: LIST_URI },
        durationMinutes: 60,
        window: WINDOW,
        title: 'Weekly sync',
      }, SERVICE),
      /scope\.type is required/
    );
    assert.deepEqual(fetchCalls, []);
  });

  it('(g) an unknown scope.type is rejected rather than silently treated as a list', async () => {
    resetHooks();
    await assert.rejects(
      () => callTool('schedule_call', {
        scope: { type: 'atproto-lst', value: LIST_URI }, // typo
        durationMinutes: 60,
        window: WINDOW,
        title: 'Weekly sync',
      }, SERVICE),
      /Unknown scope\.type "atproto-lst"/
    );
    assert.deepEqual(fetchCalls, []);
  });

  it('(h) a bare list-URI string is still accepted as Phase 1 shorthand', async () => {
    resetHooks();
    // Guards the other side of (f): a string is unambiguous — there is only one
    // kind of URI a caller can pass — so it must keep defaulting to a list.
    resolveListAvailabilityImpl = async (listUri) => {
      assert.equal(listUri, LIST_URI);
      return [member('did:plc:alice', 'auto'), member('did:plc:bob', 'auto')];
    };
    bestCallSlotsImpl = () => [
      { slot: '2026-07-21T14:00', participants: ['did:plc:alice', 'did:plc:bob'], count: 2 },
    ];

    const result = JSON.parse(await callTool('schedule_call', {
      scope: LIST_URI,
      durationMinutes: 60,
      window: WINDOW,
      title: 'Weekly sync',
    }, SERVICE));

    assert.equal(result.booked, true);
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
      }, SERVICE),
      /Phase 1/
    );
    assert.deepEqual(fetchCalls, []);
  });

  it('(i) voterDids present -> books for exactly those DIDs via resolveAvailabilityForDids, not the whole list', async () => {
    resetHooks();
    let listCalled = false;
    resolveListAvailabilityImpl = async () => { listCalled = true; return []; };
    resolveAvailabilityForDidsImpl = async (dids, listUri) => {
      assert.equal(listUri, LIST_URI);
      assert.deepEqual([...dids].sort(), ['did:plc:alice', 'did:plc:bob']);
      return [member('did:plc:alice', 'auto'), member('did:plc:bob', 'auto')];
    };
    bestCallSlotsImpl = () => [
      { slot: '2026-07-21T14:00', participants: ['did:plc:alice', 'did:plc:bob'], count: 2 },
    ];

    const result = JSON.parse(await callTool('schedule_call', {
      scope: { type: 'atproto-list', value: LIST_URI },
      durationMinutes: 60, window: WINDOW, title: 'Voted call',
      voterDids: ['did:plc:alice', 'did:plc:bob'],
    }, SERVICE));

    assert.equal(result.booked, true);
    assert.equal(listCalled, false, 'whole-list resolution must NOT run when voterDids is given');
    assert.equal(result.coverage.withRecords, 2);
    assert.equal(result.coverage.voters, 2);
    assert.equal(result.coverage.votersWithoutRecords, 0);
  });

  it('(j) a voter with no record is a coverage miss -> falls back, does not widen the set', async () => {
    resetHooks();
    resolveAvailabilityForDidsImpl = async () => [member('did:plc:alice', 'auto')]; // only 1 of 2 has a record
    const result = JSON.parse(await callTool('schedule_call', {
      scope: { type: 'atproto-list', value: LIST_URI },
      durationMinutes: 60, window: WINDOW, title: 'Voted call',
      voterDids: ['did:plc:alice', 'did:plc:ghost'],
    }, SERVICE));
    assert.equal(result.booked, false);
    assert.equal(result.fallback, 'create_poll');
  });

  it('(k) voterDids present but empty is a caller error, not a silent poll fallback', async () => {
    resetHooks();
    await assert.rejects(
      () => callTool('schedule_call', {
        scope: { type: 'atproto-list', value: LIST_URI },
        durationMinutes: 60, window: WINDOW, title: 'x', voterDids: [],
      }, SERVICE),
      /voterDids.*non-empty|non-empty.*voterDids/i
    );
    assert.deepEqual(fetchCalls, []);
  });

  it('(l) a non-array (or non-DID) voterDids is rejected', async () => {
    resetHooks();
    await assert.rejects(
      () => callTool('schedule_call', {
        scope: { type: 'atproto-list', value: LIST_URI },
        durationMinutes: 60, window: WINDOW, title: 'x', voterDids: 'did:plc:alice',
      }, SERVICE),
      /voterDids must be an array/i
    );
    await assert.rejects(
      () => callTool('schedule_call', {
        scope: { type: 'atproto-list', value: LIST_URI },
        durationMinutes: 60, window: WINDOW, title: 'x', voterDids: ['not-a-did'],
      }, SERVICE),
      /voterDids must be an array/i
    );
  });
});

// #149: the tool books real calls and mails ICS invites to the people it books,
// and Bluesky lists are public records, so the list URI was never the barrier.
// It used to accept any caller, including one with no credential at all.
describe('schedule_call authorization', () => {
  const ARGS = {
    scope: { type: 'atproto-list', value: LIST_URI },
    durationMinutes: 60,
    window: WINDOW,
    title: 'Weekly sync',
  };

  // Every rejection below also asserts nothing was resolved and no mail was
  // sent. A gate that refuses AFTER doing the work would still leak the
  // group's schedule and still email people.
  function assertDidNothing() {
    assert.deepEqual(fetchCalls, []);
    assert.deepEqual(sendEmailCalls, []);
  }

  it('refuses an anonymous caller with AUTH_REQUIRED, which the handler turns into a 401', async () => {
    resetHooks();
    resolveListAvailabilityImpl = async () => { throw new Error('must not resolve for an anonymous caller'); };
    await assert.rejects(() => callTool('schedule_call', ARGS, null), /AUTH_REQUIRED/);
    assertDidNothing();
  });

  it('refuses a signed-in stranger, and does NOT send them back through OAuth', async () => {
    resetHooks();
    resolveListAvailabilityImpl = async () => { throw new Error('must not resolve for a non-owner'); };
    // Not AUTH_REQUIRED: they are already authenticated, so another OAuth round
    // trip would not help and pretending otherwise would be a lie.
    await assert.rejects(() => callTool('schedule_call', ARGS, STRANGER), /Not your list/);
    await assert.doesNotReject(async () => {
      try { await callTool('schedule_call', ARGS, STRANGER); } catch (err) {
        assert.ok(!/AUTH_REQUIRED/.test(err.message));
      }
    });
    assertDidNothing();
  });

  it('allows the list owner — the DID in the list URI is its owner, no lookup needed', async () => {
    resetHooks();
    resolveListAvailabilityImpl = async () => [member('did:plc:alice', 'auto'), member('did:plc:bob', 'auto')];
    bestCallSlotsImpl = () => [{ slot: '2026-07-21T14:00', participants: ['did:plc:alice', 'did:plc:bob'], count: 2 }];
    const result = JSON.parse(await callTool('schedule_call', ARGS, OWNER));
    assert.equal(result.booked, true);
  });

  it('allows the service credential, which has no DID at all', async () => {
    resetHooks();
    resolveListAvailabilityImpl = async () => [member('did:plc:alice', 'auto'), member('did:plc:bob', 'auto')];
    bestCallSlotsImpl = () => [{ slot: '2026-07-21T14:00', participants: ['did:plc:alice', 'did:plc:bob'], count: 2 }];
    const result = JSON.parse(await callTool('schedule_call', ARGS, SERVICE));
    assert.equal(result.booked, true);
  });

  it('a DID that merely prefixes the owner is not the owner', async () => {
    resetHooks();
    resolveListAvailabilityImpl = async () => { throw new Error('must not resolve'); };
    const almost = { service: null, did: 'did:plc:creato', handle: 'x', oauthSession: null };
    await assert.rejects(() => callTool('schedule_call', ARGS, almost), /Not your list/);
    assertDidNothing();
  });
});
