import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { indexPoll, updatePollPublished, listByCommunity } from '../src/lib/pollIndex.js';

// Community-feed publish flag (#5 sub-project F): a poll's PDS record carries
// communityFeedPublishedAt; the index mirrors it as publishedAt so the list
// endpoint can filter on it. Each test uses a distinct community so the
// module-level Map (shared across it() blocks in this one process) can't collide.
describe('poll index community-feed publish flag', () => {
  it('indexPoll defaults publishedAt to null; updatePollPublished sets and clears it', () => {
    indexPoll('did:plc:a', 'p1', { title: 'P1', community: 'c-set', status: 'open', createdAt: '2026-07-01T00:00:00Z' });
    assert.equal(listByCommunity('c-set')[0].publishedAt, null);
    updatePollPublished('did:plc:a', 'p1', '2026-07-19T12:00:00Z');
    assert.equal(listByCommunity('c-set')[0].publishedAt, '2026-07-19T12:00:00Z');
    updatePollPublished('did:plc:a', 'p1', null);
    assert.equal(listByCommunity('c-set')[0].publishedAt, null);
  });

  it('re-indexing an existing poll preserves publishedAt', () => {
    indexPoll('did:plc:a', 'p2', { title: 'P2', community: 'c-preserve', status: 'open', createdAt: '2026-07-01T00:00:00Z' });
    updatePollPublished('did:plc:a', 'p2', '2026-07-19T12:00:00Z');
    indexPoll('did:plc:a', 'p2', { title: 'P2 renamed', community: 'c-preserve', status: 'open', createdAt: '2026-07-01T00:00:00Z' });
    const entry = listByCommunity('c-preserve')[0];
    assert.equal(entry.publishedAt, '2026-07-19T12:00:00Z');
    assert.equal(entry.title, 'P2 renamed');
  });

  it('listByCommunity publishedOnly filters to published polls; no opts stays back-compatible', () => {
    indexPoll('did:plc:a', 'u1', { title: 'U1', community: 'c-filter', status: 'open', createdAt: '2026-07-01T00:00:00Z' });
    indexPoll('did:plc:a', 'u2', { title: 'U2', community: 'c-filter', status: 'open', createdAt: '2026-07-02T00:00:00Z' });
    updatePollPublished('did:plc:a', 'u2', '2026-07-19T12:00:00Z');
    assert.deepEqual(listByCommunity('c-filter', 'open', { publishedOnly: true }).map((p) => p.rkey), ['u2']);
    assert.equal(listByCommunity('c-filter', 'open').length, 2);
  });
});
