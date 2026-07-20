import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.CA_MEMBERSHIP_URL = 'https://ca.test';
process.env.CA_CONFIG_SECRET = 'svc';

// Control the membership gate per test via mock.module.
let membershipOk = true;
import { mock } from 'node:test';
mock.module('../src/lib/membership.js', {
  namedExports: {
    assertMembership: async (_did, community) => {
      if (!membershipOk) throw new Error(`You're not a member of "${community}".`);
    },
  },
});

// PDS reads go through global fetch (resolvePds + getRecord); the PDS WRITE goes
// through authContext.oauthSession.fetchHandler, so it never touches global fetch.
let pollRecord = null;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('plc.directory')) {
    return { ok: true, json: async () => ({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.test' }] }) };
  }
  if (u.includes('getRecord')) {
    if (!pollRecord) return { ok: false, status: 404 };
    return { ok: true, json: async () => pollRecord };
  }
  return { ok: true, json: async () => ({}) };
};

const { publishToCommunityFeed } = await import('../src/mcp/tools.js');
const { indexPoll, listByCommunity } = await import('../src/lib/pollIndex.js');

const CREATOR = 'did:plc:creator';

function makeOauth() {
  const putCalls = [];
  return {
    putCalls,
    session: {
      fetchHandler: async (_path, init) => {
        putCalls.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({}) };
      },
    },
  };
}

function seedPoll(rkey, community) {
  pollRecord = { value: { title: 'P', community, status: 'open', createdAt: '2026-07-01T00:00:00Z' }, cid: 'cid1' };
  if (community) indexPoll(CREATOR, rkey, { title: 'P', community, status: 'open', createdAt: '2026-07-01T00:00:00Z' });
}

describe('publishToCommunityFeed', () => {
  it('rejects without auth or without an oauthSession', async () => {
    await assert.rejects(() => publishToCommunityFeed({ did: CREATOR, rkey: 'r1' }, null), /AUTH_REQUIRED/);
    await assert.rejects(() => publishToCommunityFeed({ did: CREATOR, rkey: 'r1' }, { did: CREATOR }), /AUTH_REQUIRED/);
  });

  it('rejects a non-creator without touching membership or the index', async () => {
    membershipOk = true;
    seedPoll('r-nc', 'c-nc');
    const { session, putCalls } = makeOauth();
    await assert.rejects(
      () => publishToCommunityFeed({ did: CREATOR, rkey: 'r-nc' }, { did: 'did:plc:other', oauthSession: session }),
      /creator/
    );
    assert.equal(putCalls.length, 0);
    assert.equal(listByCommunity('c-nc', 'open', { publishedOnly: true }).length, 0);
  });

  it('publishes: sets communityFeedPublishedAt on the record and mirrors to the index', async () => {
    membershipOk = true;
    seedPoll('r-pub', 'c-pub');
    const { session, putCalls } = makeOauth();
    const out = JSON.parse(await publishToCommunityFeed({ did: CREATOR, rkey: 'r-pub' }, { did: CREATOR, oauthSession: session }));
    assert.equal(out.published, true);
    assert.equal(putCalls.length, 1);
    assert.ok(putCalls[0].record.communityFeedPublishedAt);
    const listed = listByCommunity('c-pub', 'open', { publishedOnly: true });
    assert.deepEqual(listed.map((p) => p.rkey), ['r-pub']);
  });

  it('unpublishes: published=false clears the field and the index flag', async () => {
    membershipOk = true;
    seedPoll('r-un', 'c-un');
    const { session, putCalls } = makeOauth();
    await publishToCommunityFeed({ did: CREATOR, rkey: 'r-un' }, { did: CREATOR, oauthSession: session });
    const out = JSON.parse(await publishToCommunityFeed({ did: CREATOR, rkey: 'r-un', published: false }, { did: CREATOR, oauthSession: session }));
    assert.equal(out.published, false);
    assert.equal('communityFeedPublishedAt' in putCalls[1].record, false);
    assert.equal(listByCommunity('c-un', 'open', { publishedOnly: true }).length, 0);
  });

  it('a non-member is rejected before any PDS write', async () => {
    membershipOk = false;
    seedPoll('r-nm', 'c-nm');
    const { session, putCalls } = makeOauth();
    await assert.rejects(() => publishToCommunityFeed({ did: CREATOR, rkey: 'r-nm' }, { did: CREATOR, oauthSession: session }), /not a member/);
    assert.equal(putCalls.length, 0);
    assert.equal(listByCommunity('c-nm', 'open', { publishedOnly: true }).length, 0);
  });

  it('a poll with no community is rejected', async () => {
    membershipOk = true;
    pollRecord = { value: { title: 'P', status: 'open', createdAt: '2026-07-01T00:00:00Z' }, cid: 'cid1' };
    const { session } = makeOauth();
    await assert.rejects(() => publishToCommunityFeed({ did: CREATOR, rkey: 'r-noc' }, { did: CREATOR, oauthSession: session }), /no community set/);
  });
});
