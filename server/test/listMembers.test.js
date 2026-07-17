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
        return { ok: true, json: async () => ({ records: [availabilityRecord('did:plc:ok')] }) };
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };

    const result = await resolveListAvailability(LIST_URI);
    assert.equal(result.length, 1);
    assert.equal(result[0].did, 'did:plc:ok');
  });
});
