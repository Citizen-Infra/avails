import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertEventAvailabilityGrant, EventGrantError } from '../src/lib/eventGrant.js';

const EVENT_DID = 'did:plc:mzvqnxye3oejamuwmfl4qvou';
const SUBJECT_DID = 'did:plc:participant';
const originalFetch = globalThis.fetch;
let calls;
let response;

globalThis.fetch = async (...args) => {
  calls.push(args);
  if (response instanceof Error) throw response;
  return response;
};

beforeEach(() => {
  calls = [];
  process.env.CA_MEMBERSHIP_URL = 'https://community-admin.test/';
  process.env.CA_CONFIG_SECRET = 'shared-secret';
  response = {
    ok: true,
    json: async () => ({
      relationship: 'event-participant',
      event_did: EVENT_DID,
      subject_did: SUBJECT_DID,
      capability: 'publish-standing-availability',
      active: true,
      reason: 'active',
    }),
  };
});

after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.CA_MEMBERSHIP_URL;
  delete process.env.CA_CONFIG_SECRET;
});

describe('event grant introspection', () => {
  it('posts the authenticated subject and does not cache active decisions', async () => {
    await assertEventAvailabilityGrant(EVENT_DID, SUBJECT_DID);
    await assertEventAvailabilityGrant(EVENT_DID, SUBJECT_DID);

    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], 'https://community-admin.test/internal/event-participant-grants/introspect');
    assert.equal(calls[0][1].headers.Authorization, 'Bearer shared-secret');
    assert.deepEqual(JSON.parse(calls[0][1].body), {
      event_did: EVENT_DID,
      subject_did: SUBJECT_DID,
      capability: 'publish-standing-availability',
    });
  });

  it('returns a non-authorizing 403 with the producer reason for an inactive grant', async () => {
    response.json = async () => ({
      relationship: 'event-participant',
      event_did: EVENT_DID,
      subject_did: SUBJECT_DID,
      capability: 'publish-standing-availability',
      active: false,
      reason: 'blocked-by',
    });

    await assert.rejects(
      () => assertEventAvailabilityGrant(EVENT_DID, SUBJECT_DID),
      (err) => err instanceof EventGrantError && err.status === 403 && err.reason === 'blocked-by'
    );
  });

  it('fails closed on outage and never attempts a graph fallback', async () => {
    response = new Error('offline');
    await assert.rejects(
      () => assertEventAvailabilityGrant(EVENT_DID, SUBJECT_DID),
      (err) => err instanceof EventGrantError && err.status === 503 && err.retryable
    );
    assert.equal(calls.length, 1, 'only the Community Admin introspection request is allowed');
  });

  it('fails closed before fetch when consumer configuration is missing', async () => {
    delete process.env.CA_CONFIG_SECRET;
    await assert.rejects(
      () => assertEventAvailabilityGrant(EVENT_DID, SUBJECT_DID),
      (err) => err instanceof EventGrantError && err.status === 503 && err.retryable
    );
    assert.equal(calls.length, 0);
  });

  it('rejects a mismatched or malformed producer decision', async () => {
    response.json = async () => ({
      relationship: 'event-participant',
      event_did: 'did:plc:other',
      subject_did: SUBJECT_DID,
      capability: 'publish-standing-availability',
      active: true,
      reason: 'active',
    });
    await assert.rejects(
      () => assertEventAvailabilityGrant(EVENT_DID, SUBJECT_DID),
      (err) => err instanceof EventGrantError && err.status === 503
    );
  });
});
