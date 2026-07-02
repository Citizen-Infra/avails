// Gates community-scoped actions (share_poll) on community-admin membership.
// avails has already cryptographically verified the caller's DID via its own
// ATProto OAuth; here we ask community-admin (the source of truth) whether that
// DID is a member of the target community. FAILS CLOSED: any error → deny.
// See community-admin/docs/plans/2026-06-29-s4-idp-design.md.

export async function assertMembership(did, community) {
  // Strip a trailing slash so a mis-set env var doesn't produce `//api/...` (404 → denies every member).
  const base = process.env.CA_MEMBERSHIP_URL?.replace(/\/$/, '');
  const secret = process.env.CA_CONFIG_SECRET;
  if (!base || !secret) {
    throw new Error('Membership check is not configured (CA_MEMBERSHIP_URL / CA_CONFIG_SECRET).');
  }

  const url = `${base}/api/memberships?subject=${encodeURIComponent(did)}`;
  let data;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
    if (!res.ok) throw new Error(`membership lookup failed (${res.status})`);
    data = await res.json();
  } catch {
    // Fail closed — never allow a share when membership can't be verified.
    throw new Error(`Could not verify your membership of "${community}" right now. Please try again.`);
  }

  // `community` is a slug (e.g. "cibc") and must equal community-admin's
  // `community_id` (a lowercased slug). Both are lowercase for current
  // communities; keep them aligned so a member is never silently denied.
  const memberships = Array.isArray(data?.memberships) ? data.memberships : [];
  if (!memberships.some((m) => m.community_id === community)) {
    throw new Error(`You're not a member of "${community}". Ask a community admin to add your Bluesky handle in community-admin.`);
  }
}
