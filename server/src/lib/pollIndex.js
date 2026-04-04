// Poll index for community-based discovery.
// key: `${did}/${rkey}` → { did, rkey, title, community, status, responseCount, createdAt }
// Persisted to Railway volume via persistence.js.

import { registerStore, markDirty } from './persistence.js';

const polls = new Map();
registerStore('poll-index', polls);

export function indexPoll(did, rkey, poll) {
  const key = `${did}/${rkey}`;
  polls.set(key, {
    did,
    rkey,
    title: poll.title,
    community: poll.community,
    status: poll.status || 'open',
    responseCount: poll.responseCount || 0,
    createdAt: poll.createdAt || new Date().toISOString(),
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

export function listByCommunity(community, status = 'open') {
  const results = [];
  for (const entry of polls.values()) {
    if (entry.community === community && entry.status === status) {
      results.push(entry);
    }
  }
  // Sort by createdAt descending
  results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return results;
}
