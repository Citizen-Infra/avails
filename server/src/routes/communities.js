import { Router } from 'express';
import { fetchCommunityConfig } from '../lib/communityConfig.js';
import { fetchMemberships } from '../lib/membership.js';
import { getSession } from '../lib/sessionStore.js';

const router = Router();

// The poll-creator's community dropdown. Sources from community-admin (the source
// of truth since IdP S2 — NOT scenius-digest) and returns [{ id, name }] so the
// client <Select> can render it. Anonymous callers see public communities only.
// A caller with a valid app session also sees the communities community-admin
// confirms they belong to, including private/setup communities omitted from
// /api/config. Reading the DID does not restore OAuth because this route makes no
// authenticated ATProto request.
router.get('/', async (req, res) => {
  // This URL now varies by the caller's session. Never let a browser or shared
  // intermediary reuse a response containing private community names.
  res.set('Cache-Control', 'private, no-store');
  try {
    const sessionId = req.cookies?.avails_session;
    const did = sessionId ? getSession(sessionId)?.did : null;
    const membershipPromise = did
      ? fetchMemberships(did).catch((err) => {
          // Fail closed without breaking public discovery: a CA outage must not
          // expose private names, and it need not hide already-public entries.
          console.warn('Community memberships fetch error:', err.message);
          return [];
        })
      : Promise.resolve([]);

    const [communities, memberships] = await Promise.all([
      fetchCommunityConfig(),
      membershipPromise,
    ]);
    const visible = new Map(Object.entries(communities)
      .filter(([, c]) => c.visibility !== 'private')
      .map(([id, c]) => [id, { id, name: c.name }]));

    for (const membership of memberships) {
      if (membership?.community_id && membership?.name) {
        visible.set(membership.community_id, {
          id: membership.community_id,
          name: membership.name,
        });
      }
    }

    res.json([...visible.values()]);
  } catch (err) {
    console.error('Communities fetch error:', err);
    res.status(502).json({ error: 'Failed to fetch communities' });
  }
});

export default router;
