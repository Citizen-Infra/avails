/**
 * The ICS UID must not move when the deployment host does.
 *
 * RFC 5545 §3.8.4.7 defines UID as "the persistent, globally unique identifier
 * for the calendar component" and calls it "an important method for
 * group-scheduling applications to match requests with later replies,
 * modifications, or deletion requests." A METHOD:CANCEL only removes an event
 * from someone's calendar if its UID matches the REQUEST they already have.
 *
 * icsUidFor derived the right-hand side from CLIENT_URL, so the 2026-08-04 move
 * from avails.zhgnv.com to avails.citizeninfra.org silently changed the UID of
 * every event already invited. Nothing failed loudly; cancellations issued
 * afterwards would simply not have matched.
 *
 * The RFC's recommendation is that the right-hand side carry "some domain
 * identifier (either of the host itself or otherwise)" — "or otherwise" is what
 * makes a frozen namespace correct rather than a workaround. Uniqueness here
 * does not depend on it at all: the left-hand side already contains a DID,
 * which is globally unique by construction.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { icsUidFor, generateIcs } from '../src/lib/ical.js';

const DID = 'did:plc:creator';
const RKEY = 'poll1';

const poll = {
  title: 'Weekly sync',
  finalTime: '2026-07-21T14:00:00.000Z',
  finalDuration: 60,
};

beforeEach(() => {
  delete process.env.CLIENT_URL;
});

test('the UID does not change when CLIENT_URL changes', () => {
  // The regression. These two hosts are the real ones from the migration.
  process.env.CLIENT_URL = 'https://avails.zhgnv.com';
  const before = icsUidFor(DID, RKEY);
  process.env.CLIENT_URL = 'https://avails.citizeninfra.org';
  const after = icsUidFor(DID, RKEY);

  assert.equal(
    before,
    after,
    'a host move must not change the UID — cancellations match on it'
  );
});

test('the UID survives CLIENT_URL being unset entirely', () => {
  const set = (() => {
    process.env.CLIENT_URL = 'https://avails.citizeninfra.org';
    return icsUidFor(DID, RKEY);
  })();
  delete process.env.CLIENT_URL;
  assert.equal(icsUidFor(DID, RKEY), set);
});

test('the UID namespace is frozen', () => {
  // Pinned deliberately. If you are changing this literal because the host
  // moved: don't. Every event already invited carries the old value, and
  // changing it means their cancellations stop matching. The namespace is not
  // a deployment address.
  assert.equal(icsUidFor(DID, RKEY), 'avails-did:plc:creator-poll1@avails.citizeninfra.org');
});

test('a REQUEST and its later CANCEL carry the same UID', () => {
  // The property the whole thing exists for, asserted end to end rather than
  // on the helper alone.
  const req = generateIcs({ poll, pollUrl: 'https://x.test/p/a/b', did: DID, rkey: RKEY });
  const cancel = generateIcs({
    poll, pollUrl: 'https://x.test/p/a/b', did: DID, rkey: RKEY, method: 'CANCEL',
  });

  const uidOf = (ics) => ics.match(/UID:(.+)/)[1].trim();
  assert.equal(uidOf(req), uidOf(cancel));
  assert.match(req, /METHOD:REQUEST/);
  assert.match(cancel, /METHOD:CANCEL/);
});

test('a CANCEL issued after a host move still matches the original REQUEST', () => {
  // Replays the migration: invite sent on the old host, cancellation on the new.
  process.env.CLIENT_URL = 'https://avails.zhgnv.com';
  const req = generateIcs({ poll, pollUrl: 'https://old.test/p/a/b', did: DID, rkey: RKEY });

  process.env.CLIENT_URL = 'https://avails.citizeninfra.org';
  const cancel = generateIcs({
    poll, pollUrl: 'https://new.test/p/a/b', did: DID, rkey: RKEY, method: 'CANCEL',
  });

  const uidOf = (ics) => ics.match(/UID:(.+)/)[1].trim();
  assert.equal(uidOf(req), uidOf(cancel), 'this is what the host move broke');
});

test('different polls get different UIDs', () => {
  assert.notEqual(icsUidFor(DID, 'poll1'), icsUidFor(DID, 'poll2'));
  assert.notEqual(icsUidFor('did:plc:other', RKEY), icsUidFor(DID, RKEY));
});
