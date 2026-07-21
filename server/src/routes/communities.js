import { Router } from 'express';
import { fetchCommunityConfig } from '../lib/communityConfig.js';

const router = Router();

// The poll-creator's community dropdown. Sources from community-admin (the source
// of truth since IdP S2 — NOT scenius-digest) and returns [{ id, name }] so the
// client <Select> can render it. This route is unauthenticated, so it exposes
// PUBLIC communities only — CA /api/config returns private communities too, and
// leaking their names to anonymous callers would be a privacy regression.
// (Membership-aware inclusion of a signed-in user's own private communities is a
// follow-up: authenticate the caller + filter by /api/memberships.)
router.get('/', async (req, res) => {
  try {
    const communities = await fetchCommunityConfig();
    const list = Object.entries(communities)
      .filter(([, c]) => c.visibility !== 'private')
      .map(([id, c]) => ({ id, name: c.name }));
    res.json(list);
  } catch (err) {
    console.error('Communities fetch error:', err);
    res.status(502).json({ error: 'Failed to fetch communities' });
  }
});

export default router;
