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
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

// The booking ledger (#166) registers a persistence store at import time and
// writes through it durably. Point DATA_DIR at a throwaway directory before
// tools.js pulls the ledger in, so the suite never touches ./data.
process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), 'avails-booking-'));

const { callTool } = await import('../src/mcp/tools.js');
const { _resetBookingLedger } = await import('../src/mcp/bookingLedger.js');

function resetHooks() {
  sendEmailCalls = [];
  fetchCalls = [];
  _resetBookingLedger();
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

  // A ca-community scope has no whole-group path — avails cannot read a
  // community's roster — so it is the caller's DIDs or nothing. The failure
  // must name the missing argument: resolving zero members instead would be
  // reported as "nobody has published availability", sending the organizer to
  // chase a coverage problem that does not exist.
  // The failure this catches is not "it errored" — it is that a malformed
  // window produced ZERO candidate slots, which surfaced as a fallback with
  // "no overlapping availability found" and was announced to members as though
  // nobody could make it. community-admin sent ISO timestamps for fourteen
  // months and not one call-proposal ever booked.
  it('(w1) an ISO date-time window is refused, rather than silently yielding no slots', async () => {
    resetHooks();

    await assert.rejects(
      () => callTool('schedule_call', {
        scope: LIST_URI,
        durationMinutes: 60,
        window: { start: '2026-07-21T00:00:00.000Z', end: '2026-07-28T00:00:00.000Z' },
        title: 'Weekly sync',
      }, SERVICE),
      (err) => {
        assert.match(err.message, /YYYY-MM-DD/);
        // The reason must name the silent failure, or the next caller "fixes"
        // it by loosening the check.
        assert.match(err.message, /no candidate slots/);
        return true;
      }
    );
    assert.deepEqual(fetchCalls, []);
  });

  it('(w2) a plain date window is accepted', async () => {
    resetHooks();
    resolveListAvailabilityImpl = async () => [member('did:plc:alice', 'auto'), member('did:plc:bob', 'auto')];
    bestCallSlotsImpl = () => [
      { slot: '2026-07-21T14:00', participants: ['did:plc:alice', 'did:plc:bob'], count: 2 },
    ];

    const result = JSON.parse(await callTool('schedule_call', {
      scope: LIST_URI, durationMinutes: 60,
      window: { start: '2026-07-21', end: '2026-07-28' }, title: 'Weekly sync',
    }, SERVICE));
    assert.equal(result.booked, true);
  });

  it('(w3) a backwards window is refused', async () => {
    resetHooks();
    await assert.rejects(
      () => callTool('schedule_call', {
        scope: LIST_URI, durationMinutes: 60,
        window: { start: '2026-07-28', end: '2026-07-21' }, title: 'Weekly sync',
      }, SERVICE),
      /before window\.start/
    );
  });

  it('(e) a ca-community scope without voterDids fails naming the missing argument, before touching resolveListAvailability', async () => {
    resetHooks();
    // resolveListAvailabilityImpl left as the "should not be called" throw.

    await assert.rejects(
      () => callTool('schedule_call', {
        scope: { type: 'ca-community', value: 'cibc' },
        durationMinutes: 60,
        window: WINDOW,
        title: 'Weekly sync',
      }, SERVICE),
      /requires voterDids/
    );
    assert.deepEqual(fetchCalls, []);
  });

  it('(e2) a ca-community scope WITH voterDids books, and the scope object reaches the resolver intact', async () => {
    resetHooks();
    let listCalled = false;
    resolveListAvailabilityImpl = async () => { listCalled = true; return []; };
    resolveAvailabilityForDidsImpl = async (dids, scope) => {
      // The whole point of the ca-community arm: the community id travels as a
      // typed scope, not flattened to a bare string that would normalize back
      // to atproto-list and match nothing.
      assert.deepEqual(scope, { type: 'ca-community', value: 'cibc' });
      assert.deepEqual([...dids].sort(), ['did:plc:alice', 'did:plc:bob']);
      return [member('did:plc:alice', 'auto'), member('did:plc:bob', 'auto')];
    };
    bestCallSlotsImpl = () => [
      { slot: '2026-07-21T14:00', participants: ['did:plc:alice', 'did:plc:bob'], count: 2 },
    ];

    const result = JSON.parse(await callTool('schedule_call', {
      scope: { type: 'ca-community', value: 'cibc' },
      durationMinutes: 60, window: WINDOW, title: 'Season 3 kickoff',
      voterDids: ['did:plc:alice', 'did:plc:bob'],
    }, SERVICE));

    assert.equal(result.booked, true);
    assert.equal(listCalled, false);
  });

  // Authorization for a community cannot fall back to the list-owner check:
  // there is no owner DID in "cibc" to compare against, and slicing at:// off a
  // community id yields garbage that would never match — accidentally safe, but
  // for the wrong reason and with a nonsense message. Only the service may.
  //
  // Assert the REASON, not just the refusal. Deleting the community branch
  // still rejects, because slicing "at://" off "cibc" yields "" which matches
  // no DID — so a test that only checked "it threw", or matched the words
  // "authorized service" (present in BOTH messages), passes against the bug.
  // Mutation-checked: this is the assertion that fails when the branch goes.
  it('(e3) a ca-community scope is refused for a signed-in non-service caller, before any read', async () => {
    resetHooks();

    await assert.rejects(
      () => callTool('schedule_call', {
        scope: { type: 'ca-community', value: 'cibc' },
        durationMinutes: 60, window: WINDOW, title: 'Weekly sync',
        voterDids: ['did:plc:alice', 'did:plc:bob'],
      }, OWNER),
      (err) => {
        assert.match(err.message, /not readable from ATProto/);
        assert.doesNotMatch(err.message, /Not your list/, 'must not fall through to the list-owner check');
        return true;
      }
    );
    assert.deepEqual(fetchCalls, []);
  });

  it('(i) voterDids present -> books for exactly those DIDs via resolveAvailabilityForDids, not the whole list', async () => {
    resetHooks();
    let listCalled = false;
    resolveListAvailabilityImpl = async () => { listCalled = true; return []; };
    resolveAvailabilityForDidsImpl = async (dids, scope) => {
      assert.deepEqual(scope, { type: 'atproto-list', value: LIST_URI });
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

// ---------------------------------------------------------------------------
// Idempotency (#166)
//
// schedule_call books a real call and mails real people. A request that
// succeeds here and fails to return — a timeout, a dropped connection, a
// container replaced mid-reply — is indistinguishable to the caller from one
// that never arrived, so the caller retries. Without a memory here, that books
// a second call and sends everyone a second calendar invitation.
//
// These tests use members WITH an email address (the base `member()` helper
// omits one, so most tests above mail nobody) because the count of invitations
// sent is the harm being asserted, not the count of rows.
// ---------------------------------------------------------------------------
describe('schedule_call idempotency (#166)', () => {
  const BOOK_ARGS = {
    scope: { type: 'atproto-list', value: LIST_URI },
    durationMinutes: 60,
    window: WINDOW,
    title: 'Weekly sync',
  };

  function mailedMember(did, trust = 'auto') {
    const m = member(did, trust);
    m.record.value.email = `${did.split(':').pop()}@example.test`;
    return m;
  }

  function bookable(members) {
    resolveListAvailabilityImpl = async () => members;
    bestCallSlotsImpl = () => [
      { slot: '2026-07-21T14:00', participants: members.map((m) => m.did), count: members.length },
    ];
    return members;
  }

  it('a repeated key returns the first booking instead of booking a second call', async () => {
    resetHooks();
    bookable([mailedMember('did:plc:alice'), mailedMember('did:plc:bob')]);

    const first = JSON.parse(
      await callTool('schedule_call', { ...BOOK_ARGS, idempotencyKey: 'proposal-42' }, SERVICE)
    );
    assert.equal(first.booked, true);
    assert.equal(first.alreadyBooked, undefined, 'a first booking is not flagged as a repeat');
    assert.equal(sendEmailCalls.length, 2);

    // A retry must not reach availability resolution at all: the stored answer
    // comes back before any work happens.
    resolveListAvailabilityImpl = async () => { throw new Error('must not resolve on a retry'); };
    bestCallSlotsImpl = () => { throw new Error('must not recompute on a retry'); };

    const second = JSON.parse(
      await callTool('schedule_call', { ...BOOK_ARGS, idempotencyKey: 'proposal-42' }, SERVICE)
    );
    assert.equal(second.booked, true);
    assert.equal(second.alreadyBooked, true, 'the caller can tell this apart from a fresh booking');
    assert.equal(second.slot, first.slot);
    assert.deepEqual(second.participants, first.participants);
    assert.ok(second.bookedAt, 'carries when the original booking happened');

    // The blast radius #166 exists to prevent.
    assert.equal(sendEmailCalls.length, 2, 'no second round of calendar invitations');
  });

  it('records the booking durably, not on the 30-second flush', async () => {
    resetHooks();
    bookable([mailedMember('did:plc:alice'), mailedMember('did:plc:bob')]);
    await callTool('schedule_call', { ...BOOK_ARGS, idempotencyKey: 'durable-1' }, SERVICE);

    // On disk by the time the call returns. The periodic flush is exactly the
    // blind spot here: a container replaced immediately after booking would
    // otherwise come back with no memory of it.
    const onDisk = JSON.parse(
      await readFile(path.join(process.env.DATA_DIR, 'call-bookings.json'), 'utf8')
    );
    assert.ok(onDisk['durable-1'], 'key is on disk before the call returns');
    assert.equal(onDisk['durable-1'].result.slot, '2026-07-21T14:00');
  });

  it('different keys are different bookings', async () => {
    resetHooks();
    bookable([mailedMember('did:plc:alice'), mailedMember('did:plc:bob')]);

    const a = JSON.parse(await callTool('schedule_call', { ...BOOK_ARGS, idempotencyKey: 'k-a' }, SERVICE));
    const b = JSON.parse(await callTool('schedule_call', { ...BOOK_ARGS, idempotencyKey: 'k-b' }, SERVICE));

    assert.equal(a.alreadyBooked, undefined);
    assert.equal(b.alreadyBooked, undefined);
    // Two genuinely different calls for the same group in the same window are
    // legitimate, which is why the key is caller-supplied rather than derived
    // from the request's shape.
    assert.equal(sendEmailCalls.length, 4);
  });

  it('without a key, a repeat books again — unchanged behaviour, and a choice', async () => {
    resetHooks();
    bookable([mailedMember('did:plc:alice'), mailedMember('did:plc:bob')]);

    await callTool('schedule_call', BOOK_ARGS, SERVICE);
    const second = JSON.parse(await callTool('schedule_call', BOOK_ARGS, SERVICE));

    assert.equal(second.booked, true);
    assert.equal(second.alreadyBooked, undefined);
    assert.equal(sendEmailCalls.length, 4, 'keyless callers keep the old semantics');
  });

  it('a booked:false answer is not remembered — thin coverage today may be fine tomorrow', async () => {
    resetHooks();
    // Only one member has a record: below the coverage floor.
    resolveListAvailabilityImpl = async () => [mailedMember('did:plc:alice')];

    const declined = JSON.parse(
      await callTool('schedule_call', { ...BOOK_ARGS, idempotencyKey: 'thin-1' }, SERVICE)
    );
    assert.equal(declined.booked, false);
    assert.equal(declined.fallback, 'create_poll');

    // Same key later, once more people have published availability.
    bookable([mailedMember('did:plc:alice'), mailedMember('did:plc:bob')]);
    const booked = JSON.parse(
      await callTool('schedule_call', { ...BOOK_ARGS, idempotencyKey: 'thin-1' }, SERVICE)
    );
    assert.equal(booked.booked, true);
    assert.equal(booked.alreadyBooked, undefined, 'a declined ask never becomes a phantom booking');
  });

  it('an overlapping call with the same key is refused rather than booking in parallel', async () => {
    resetHooks();
    const members = [mailedMember('did:plc:alice'), mailedMember('did:plc:bob')];
    let release;
    const gate = new Promise((r) => { release = r; });
    resolveListAvailabilityImpl = async () => { await gate; return members; };
    bestCallSlotsImpl = () => [
      { slot: '2026-07-21T14:00', participants: members.map((m) => m.did), count: 2 },
    ];

    const first = callTool('schedule_call', { ...BOOK_ARGS, idempotencyKey: 'race-1' }, SERVICE);
    await assert.rejects(
      () => callTool('schedule_call', { ...BOOK_ARGS, idempotencyKey: 'race-1' }, SERVICE),
      /already in flight/
    );

    release();
    assert.equal(JSON.parse(await first).booked, true);
    assert.equal(sendEmailCalls.length, 2, 'only one round of invitations');

    // The claim is released once the first attempt finishes, so the retry the
    // error message asks for gets the booking rather than the same refusal.
    const retry = JSON.parse(
      await callTool('schedule_call', { ...BOOK_ARGS, idempotencyKey: 'race-1' }, SERVICE)
    );
    assert.equal(retry.alreadyBooked, true);
  });

  it('rejects a blank or non-string key rather than silently booking unguarded', async () => {
    resetHooks();
    resolveListAvailabilityImpl = async () => { throw new Error('must not resolve'); };

    for (const bad of ['', '   ', 42, null]) {
      await assert.rejects(
        () => callTool('schedule_call', { ...BOOK_ARGS, idempotencyKey: bad }, SERVICE),
        /idempotencyKey/
      );
    }
    assert.deepEqual(sendEmailCalls, []);
  });
});
