import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const EVENT_SCOPE = { type: 'ca-event', value: 'did:plc:mzvqnxye3oejamuwmfl4qvou' };
const SERVICE = { service: 'community-admin', did: null, oauthSession: null };
const WINDOW = { start: '2026-09-01', end: '2026-09-30' };

let resolveCalls;
let members;
let slots;

mock.module('../src/mcp/listMembers.js', {
  namedExports: {
    resolveAvailabilityForDids: async (...args) => {
      resolveCalls.push(args);
      return members;
    },
  },
});

mock.module('../src/mcp/availabilityOverlap.js', {
  namedExports: {
    bestCallSlots: () => slots,
  },
});

const { evaluateAvailabilityOverlap } = await import('../src/mcp/evaluateAvailability.js');

beforeEach(() => {
  resolveCalls = [];
  members = [];
  slots = [];
});

describe('evaluate_availability_overlap', () => {
  it('is ready only when one shared slot reaches the threshold', async () => {
    members = [{ did: 'did:plc:a' }, { did: 'did:plc:b' }, { did: 'did:plc:c' }];
    slots = [{ slot: '2026-09-10T16:00', count: 3, participants: members.map((m) => m.did) }];

    const result = await evaluateAvailabilityOverlap({
      scope: EVENT_SCOPE,
      eligibleDids: ['did:plc:a', 'did:plc:b', 'did:plc:c'],
      window: WINDOW,
      durationMinutes: 60,
      threshold: 3,
    }, SERVICE);

    assert.deepEqual(result, {
      ready: true,
      threshold: 3,
      eligibleSupporters: 3,
      supportersWithRecords: 3,
      maxOverlap: 3,
      candidateSlot: '2026-09-10T16:00',
    });
    assert.deepEqual(resolveCalls[0][1], EVENT_SCOPE);
  });

  it('is not ready when enough supporters have records but no slot reaches threshold', async () => {
    members = [{ did: 'did:plc:a' }, { did: 'did:plc:b' }, { did: 'did:plc:c' }];
    slots = [{ slot: '2026-09-10T16:00', count: 2, participants: ['did:plc:a', 'did:plc:b'] }];

    const result = await evaluateAvailabilityOverlap({
      scope: EVENT_SCOPE,
      eligibleDids: members.map((m) => m.did),
      window: WINDOW,
      durationMinutes: 60,
      threshold: 3,
    }, SERVICE);

    assert.equal(result.ready, false);
    assert.equal(result.supportersWithRecords, 3);
    assert.equal(result.maxOverlap, 2);
  });

  it('requires service authentication before reading records', async () => {
    await assert.rejects(
      () => evaluateAvailabilityOverlap({
        scope: EVENT_SCOPE,
        eligibleDids: ['did:plc:a'],
        window: WINDOW,
        durationMinutes: 60,
        threshold: 1,
      }, { did: 'did:plc:user' }),
      /authorized service/
    );
    assert.equal(resolveCalls.length, 0);
  });

  it('does not allow a caller to lower the event readiness floor below three', async () => {
    await assert.rejects(
      () => evaluateAvailabilityOverlap({
        scope: EVENT_SCOPE,
        eligibleDids: ['did:plc:a', 'did:plc:b'],
        window: WINDOW,
        durationMinutes: 60,
        threshold: 2,
      }, SERVICE),
      /at least 3/
    );
    assert.equal(resolveCalls.length, 0);
  });

  it('refuses list and community scopes rather than falling back to their resolvers', async () => {
    await assert.rejects(
      () => evaluateAvailabilityOverlap({
        scope: { type: 'atproto-list', value: 'at://did:plc:a/app.bsky.graph.list/x' },
        eligibleDids: ['did:plc:a'],
        window: WINDOW,
        durationMinutes: 60,
        threshold: 1,
      }, SERVICE),
      /requires a ca-event scope/
    );
    assert.equal(resolveCalls.length, 0);
  });
});
