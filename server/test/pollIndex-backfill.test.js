import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { indexPoll, updatePollPublished, listByCommunity, backfillCommunityFeedPublished } from '../src/lib/pollIndex.js';

// The backfill grandfathers polls indexed before the community-feed field existed.
// listByCommunity returns entries by reference, so deleting publishedAt off a
// returned object simulates a pre-migration entry (field strictly undefined).
describe('community-feed backfill (grandfather open polls)', () => {
  it('grandfathers open polls, leaves closed unpublished, and is idempotent', () => {
    indexPoll('did:plc:a', 'bf-open', { title: 'O', community: 'c-bf', status: 'open', createdAt: '2026-06-01T00:00:00Z' });
    indexPoll('did:plc:a', 'bf-closed', { title: 'C', community: 'c-bf', status: 'closed', createdAt: '2026-06-02T00:00:00Z' });
    delete listByCommunity('c-bf', 'open')[0].publishedAt;
    delete listByCommunity('c-bf', 'closed')[0].publishedAt;

    const published = backfillCommunityFeedPublished();
    assert.equal(published, 1);
    assert.equal(listByCommunity('c-bf', 'open')[0].publishedAt, '2026-06-01T00:00:00Z');
    assert.equal(listByCommunity('c-bf', 'closed')[0].publishedAt, null);

    assert.equal(backfillCommunityFeedPublished(), 0); // second pass: nothing left to migrate
  });

  it('never re-publishes a poll that was explicitly unpublished (publishedAt = null)', () => {
    indexPoll('did:plc:a', 'bf-unpub', { title: 'U', community: 'c-bf2', status: 'open', createdAt: '2026-06-01T00:00:00Z' });
    updatePollPublished('did:plc:a', 'bf-unpub', null);
    assert.equal(backfillCommunityFeedPublished(), 0);
    assert.equal(listByCommunity('c-bf2', 'open')[0].publishedAt, null);
  });
});
