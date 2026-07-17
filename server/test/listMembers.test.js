import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

let fetchImpl;
globalThis.fetch = (...args) => fetchImpl(...args);

const { resolveListAvailability } = await import('../src/mcp/listMembers.js');

const LIST_URI = 'at://did:plc:creator/app.bsky.graph.list/abc123';

function pdsDoc(pds) {
  return {
    service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: pds }],
  };
}

function availabilityRecord(did, { scopeValue = LIST_URI, validUntil, createdAt, updatedAt, rkey = 'r1' } = {}) {
  return {
    uri: `at://${did}/chat.avails.scheduling.availability/${rkey}`,
    cid: `cid-${rkey}`,
    value: {
      scope: { type: 'atproto-list', value: scopeValue },
      pattern: { weekly: [{ day: 1, startTime: '09:00', endTime: '17:00' }] },
      timezone: 'UTC',
      trust: 'confirm',
      ...(validUntil !== undefined && { validUntil }),
      ...(createdAt !== undefined && { createdAt }),
      ...(updatedAt !== undefined && { updatedAt }),
    },
  };
}

describe('resolveListAvailability', () => {
  it('rejects a URI that is not an app.bsky.graph.list URI', async () => {
    await assert.rejects(
      () => resolveListAvailability('at://did:plc:creator/app.bsky.feed.post/xyz'),
      /app\.bsky\.graph\.list/
    );
    await assert.rejects(() => resolveListAvailability('not-a-uri'), /Invalid list URI/);
  });

  it('(a) returns only the member with a matching, unexpired record', async () => {
    fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('app.bsky.graph.getList')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { subject: { did: 'did:plc:alice' } },
              { subject: { did: 'did:plc:bob' } },
            ],
          }),
        };
      }
      if (u.startsWith('https://plc.directory/')) {
        const did = decodeURIComponent(u.replace('https://plc.directory/', ''));
        return { ok: true, json: async () => pdsDoc(`https://pds.${did.split(':').pop()}.example`) };
      }
      if (u.includes('com.atproto.repo.listRecords')) {
        const params = new URL(u).searchParams;
        const repo = params.get('repo');
        if (repo === 'did:plc:alice') {
          return {
            ok: true,
            json: async () => ({
              records: [
                availabilityRecord('did:plc:alice', {
                  validUntil: new Date(Date.now() + 86400000).toISOString(),
                  createdAt: new Date().toISOString(),
                }),
              ],
            }),
          };
        }
        // bob has no availability records at all
        return { ok: true, json: async () => ({ records: [] }) };
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };

    const result = await resolveListAvailability(LIST_URI);
    assert.equal(result.length, 1);
    assert.equal(result[0].did, 'did:plc:alice');
    assert.equal(result[0].record.uri, 'at://did:plc:alice/chat.avails.scheduling.availability/r1');
    assert.equal(result[0].record.value.scope.value, LIST_URI);
  });

  it('(b) skips a member whose only record is scoped to a different list', async () => {
    fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('app.bsky.graph.getList')) {
        return { ok: true, json: async () => ({ items: [{ subject: { did: 'did:plc:carol' } }] }) };
      }
      if (u.startsWith('https://plc.directory/')) {
        return { ok: true, json: async () => pdsDoc('https://pds.carol.example') };
      }
      if (u.includes('com.atproto.repo.listRecords')) {
        return {
          ok: true,
          json: async () => ({
            records: [
              availabilityRecord('did:plc:carol', {
                scopeValue: 'at://did:plc:other/app.bsky.graph.list/different-list',
                validUntil: new Date(Date.now() + 86400000).toISOString(),
              }),
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };

    const result = await resolveListAvailability(LIST_URI);
    assert.deepEqual(result, []);
  });

  it('(c) skips a member whose only matching record has expired', async () => {
    fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('app.bsky.graph.getList')) {
        return { ok: true, json: async () => ({ items: [{ subject: { did: 'did:plc:dave' } }] }) };
      }
      if (u.startsWith('https://plc.directory/')) {
        return { ok: true, json: async () => pdsDoc('https://pds.dave.example') };
      }
      if (u.includes('com.atproto.repo.listRecords')) {
        return {
          ok: true,
          json: async () => ({
            records: [
              availabilityRecord('did:plc:dave', {
                validUntil: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
              }),
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };

    const result = await resolveListAvailability(LIST_URI);
    assert.deepEqual(result, []);
  });

  it('(d) follows getList pagination via cursor until exhausted', async () => {
    let getListCalls = 0;
    fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('app.bsky.graph.getList')) {
        getListCalls += 1;
        const params = new URL(u).searchParams;
        if (!params.get('cursor')) {
          return {
            ok: true,
            json: async () => ({ cursor: 'page2', items: [{ subject: { did: 'did:plc:eve' } }] }),
          };
        }
        assert.equal(params.get('cursor'), 'page2');
        // second (final) page has no cursor -> pagination stops
        return { ok: true, json: async () => ({ items: [{ subject: { did: 'did:plc:frank' } }] }) };
      }
      if (u.startsWith('https://plc.directory/')) {
        const did = decodeURIComponent(u.replace('https://plc.directory/', ''));
        return { ok: true, json: async () => pdsDoc(`https://pds.${did.split(':').pop()}.example`) };
      }
      if (u.includes('com.atproto.repo.listRecords')) {
        const params = new URL(u).searchParams;
        const repo = params.get('repo');
        // LIST_URI's authority is the owner, who is now always queried (#110).
        // This test is about pagination, so the owner publishes nothing.
        if (repo === 'did:plc:creator') return { ok: true, json: async () => ({ records: [] }) };
        return { ok: true, json: async () => ({ records: [availabilityRecord(repo)] }) };
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };

    const result = await resolveListAvailability(LIST_URI);
    assert.equal(getListCalls, 2);
    const dids = result.map((r) => r.did).sort();
    assert.deepEqual(dids, ['did:plc:eve', 'did:plc:frank']);
  });

  it('(e) keeps the latest matching record (by updatedAt) when a member has more than one', async () => {
    fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('app.bsky.graph.getList')) {
        return { ok: true, json: async () => ({ items: [{ subject: { did: 'did:plc:gina' } }] }) };
      }
      if (u.startsWith('https://plc.directory/')) {
        return { ok: true, json: async () => pdsDoc('https://pds.gina.example') };
      }
      if (u.includes('com.atproto.repo.listRecords')) {
        // The owner (LIST_URI's authority) is now always queried (#110); this
        // test is about picking the latest record, so they publish nothing.
        if (new URL(u).searchParams.get('repo') === 'did:plc:creator') {
          return { ok: true, json: async () => ({ records: [] }) };
        }
        return {
          ok: true,
          json: async () => ({
            records: [
              availabilityRecord('did:plc:gina', {
                rkey: 'old',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              }),
              availabilityRecord('did:plc:gina', {
                rkey: 'new',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              }),
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };

    const result = await resolveListAvailability(LIST_URI);
    assert.equal(result.length, 1);
    assert.equal(result[0].record.uri, 'at://did:plc:gina/chat.avails.scheduling.availability/new');
  });

  it('(f) a per-member PDS resolution failure is skipped, not fatal to the whole call', async () => {
    fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('app.bsky.graph.getList')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { subject: { did: 'did:plc:broken' } },
              { subject: { did: 'did:plc:ok' } },
            ],
          }),
        };
      }
      if (u.startsWith('https://plc.directory/')) {
        const did = decodeURIComponent(u.replace('https://plc.directory/', ''));
        if (did === 'did:plc:broken') {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        return { ok: true, json: async () => pdsDoc('https://pds.ok.example') };
      }
      if (u.includes('com.atproto.repo.listRecords')) {
        // The owner (LIST_URI's authority) is now always queried (#110); this
        // test is about skipping a broken member, so they publish nothing.
        if (new URL(u).searchParams.get('repo') === 'did:plc:creator') {
          return { ok: true, json: async () => ({ records: [] }) };
        }
        return { ok: true, json: async () => ({ records: [availabilityRecord('did:plc:ok')] }) };
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };

    const result = await resolveListAvailability(LIST_URI);
    assert.equal(result.length, 1);
    assert.equal(result[0].did, 'did:plc:ok');
  });

  it('(h) includes the list owner, whom getList never returns among items (#110)', async () => {
    // Bluesky omits a list's owner from getList items and its UI refuses to let
    // an owner add themselves, so the person curating a group's list was never
    // queried — the organizer could not be scheduled through their own list.
    // LIST_URI's authority (did:plc:creator) IS the owner: a list record can
    // only live in its creator's repo.
    fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('app.bsky.graph.getList')) {
        return {
          ok: true,
          json: async () => ({
            list: { uri: LIST_URI, creator: { did: 'did:plc:creator' } },
            items: [{ subject: { did: 'did:plc:alice' } }], // owner absent, as bsky does it
          }),
        };
      }
      if (u.startsWith('https://plc.directory/')) {
        const did = decodeURIComponent(u.replace('https://plc.directory/', ''));
        return { ok: true, json: async () => pdsDoc(`https://pds.${did.split(':').pop()}.example`) };
      }
      if (u.includes('com.atproto.repo.listRecords')) {
        const repo = new URL(u).searchParams.get('repo');
        return { ok: true, json: async () => ({ records: [availabilityRecord(repo)] }) };
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };

    const result = await resolveListAvailability(LIST_URI);
    const dids = result.map((r) => r.did).sort();
    assert.deepEqual(dids, ['did:plc:alice', 'did:plc:creator']);
  });

  it('(i) does not double-count an owner who also appears in items', async () => {
    // The Bluesky UI blocks self-add, but the protocol does not — a listitem
    // record naming the owner is writable directly, so dedupe rather than
    // resolve the same PDS twice and report them as two participants.
    let creatorRecordFetches = 0;
    fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('app.bsky.graph.getList')) {
        return {
          ok: true,
          json: async () => ({
            list: { uri: LIST_URI, creator: { did: 'did:plc:creator' } },
            items: [{ subject: { did: 'did:plc:creator' } }], // owner self-added
          }),
        };
      }
      if (u.startsWith('https://plc.directory/')) {
        return { ok: true, json: async () => pdsDoc('https://pds.creator.example') };
      }
      if (u.includes('com.atproto.repo.listRecords')) {
        creatorRecordFetches += 1;
        return { ok: true, json: async () => ({ records: [availabilityRecord('did:plc:creator')] }) };
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };

    const result = await resolveListAvailability(LIST_URI);
    assert.equal(result.length, 1, 'owner must appear once, not twice');
    assert.equal(result[0].did, 'did:plc:creator');
    assert.equal(creatorRecordFetches, 1, 'owner PDS should be queried once');
  });

  it('(j) an owner who published no record for this list contributes nothing', async () => {
    // Opt-in is the record's scope, not list membership — so an admin curating
    // a roster they are not part of stays absent, exactly as before.
    fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('app.bsky.graph.getList')) {
        return {
          ok: true,
          json: async () => ({
            list: { uri: LIST_URI, creator: { did: 'did:plc:creator' } },
            items: [{ subject: { did: 'did:plc:alice' } }],
          }),
        };
      }
      if (u.startsWith('https://plc.directory/')) {
        const did = decodeURIComponent(u.replace('https://plc.directory/', ''));
        return { ok: true, json: async () => pdsDoc(`https://pds.${did.split(':').pop()}.example`) };
      }
      if (u.includes('com.atproto.repo.listRecords')) {
        const repo = new URL(u).searchParams.get('repo');
        if (repo === 'did:plc:creator') {
          return { ok: true, json: async () => ({ records: [] }) }; // admin, not a participant
        }
        return { ok: true, json: async () => ({ records: [availabilityRecord(repo)] }) };
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };

    const result = await resolveListAvailability(LIST_URI);
    assert.deepEqual(result.map((r) => r.did), ['did:plc:alice']);
  });

  it('(g) a member whose fetch times out (AbortError) is skipped, not fatal to the whole call', async () => {
    // No real timers here — fetchWithTimeout wires an AbortController's signal
    // into the fetch call and aborts after 10s in production; this mock just
    // simulates what a hung member PDS looks like once that fires: fetch
    // rejects with an AbortError instead of ever resolving.
    let sawSignalOnHungCall = false;
    fetchImpl = async (url, options) => {
      const u = String(url);
      if (u.includes('app.bsky.graph.getList')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { subject: { did: 'did:plc:slow' } },
              { subject: { did: 'did:plc:fast' } },
            ],
          }),
        };
      }
      if (u.startsWith('https://plc.directory/')) {
        const did = decodeURIComponent(u.replace('https://plc.directory/', ''));
        if (did === 'did:plc:slow') {
          sawSignalOnHungCall = Boolean(options?.signal);
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          throw err;
        }
        return { ok: true, json: async () => pdsDoc('https://pds.fast.example') };
      }
      if (u.includes('com.atproto.repo.listRecords')) {
        // The owner (LIST_URI's authority) is now always queried (#110); this
        // test is about skipping a hung member, so they publish nothing.
        if (new URL(u).searchParams.get('repo') === 'did:plc:creator') {
          return { ok: true, json: async () => ({ records: [] }) };
        }
        return { ok: true, json: async () => ({ records: [availabilityRecord('did:plc:fast')] }) };
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };

    const result = await resolveListAvailability(LIST_URI);
    assert.equal(result.length, 1);
    assert.equal(result[0].did, 'did:plc:fast');
    assert.equal(sawSignalOnHungCall, true, 'fetchWithTimeout should pass an AbortController signal through');
  });
});
