// Poll index for community-based discovery.
// key: `${did}/${rkey}` → { did, rkey, title, community, status, responseCount, createdAt, publishedAt }
// Persisted to Railway volume via persistence.js.

import { registerStore, markDirty } from './persistence.js';

const polls = new Map();
registerStore('poll-index', polls);

export function indexPoll(did, rkey, poll) {
  const key = `${did}/${rkey}`;
  const existing = polls.get(key);
  polls.set(key, {
    did,
    rkey,
    title: poll.title,
    community: poll.community,
    status: poll.status || 'open',
    responseCount: poll.responseCount || 0,
    createdAt: poll.createdAt || new Date().toISOString(),
    // Community-feed publish marker (#5 sub-project F). Presence = published.
    // Preserved across re-index (e.g. a title edit) so publishing survives.
    publishedAt: poll.publishedAt ?? existing?.publishedAt ?? null,
  });
  markDirty('poll-index');
}

export function updatePollStatus(did, rkey, status) {
  const key = `${did}/${rkey}`;
  const entry = polls.get(key);
  if (entry) {
    polls.set(key, { ...entry, status });
    markDirty('poll-index');
  }
}

// Set (ISO string) or clear (null) a poll's community-feed publish marker.
export function updatePollPublished(did, rkey, publishedAt) {
  const key = `${did}/${rkey}`;
  const entry = polls.get(key);
  if (entry) {
    polls.set(key, { ...entry, publishedAt });
    markDirty('poll-index');
  }
}

export function incrementResponseCount(did, rkey) {
  const key = `${did}/${rkey}`;
  const entry = polls.get(key);
  if (!entry) return 0;
  const newCount = (entry.responseCount || 0) + 1;
  polls.set(key, { ...entry, responseCount: newCount });
  markDirty('poll-index');
  return newCount;
}

export function removePoll(did, rkey) {
  polls.delete(`${did}/${rkey}`);
  markDirty('poll-index');
}

// One-time grandfather for the community-feed opt-in (#5 sub-project F). Polls
// indexed before the feature have no `publishedAt` field (they load from a
// pre-migration snapshot as `undefined`); keep the currently-open ones visible
// when the feed becomes opt-in by treating them as published. Idempotent by
// construction: only entries whose field is strictly `undefined` are touched, so
// once the store has been saved (every entry then a string or null) reruns are
// no-ops — and an explicitly unpublished poll (null) is never re-grandfathered.
// The server cannot write other creators' PDS records, so this is index-only;
// the record's communityFeedPublishedAt stays authoritative from here on.
// Returns the number of polls newly marked published.
export function backfillCommunityFeedPublished() {
  let published = 0;
  let touched = 0;
  for (const entry of polls.values()) {
    if (entry.publishedAt !== undefined) continue;
    entry.publishedAt = entry.status === 'open' ? (entry.createdAt || null) : null;
    if (entry.publishedAt) published += 1;
    touched += 1;
  }
  if (touched > 0) markDirty('poll-index');
  return published;
}

export function listByCommunity(community, status = 'open', { publishedOnly = false } = {}) {
  const results = [];
  for (const entry of polls.values()) {
    if (entry.community === community && entry.status === status) {
      if (publishedOnly && !entry.publishedAt) continue;
      results.push(entry);
    }
  }
  // Sort by createdAt descending
  results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return results;
}
