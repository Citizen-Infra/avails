// community-admin is the source of truth for community config (IdP S2) — it emits
// active communities with a Telegram group_id + output_channel + topics + visibility.
// Read directly from /api/config (Bearer CA_CONFIG_SECRET), reusing the same
// community-admin base as the S4 membership gate. scenius-digest is no longer in
// this path (it was a temporary middleman, unrelated to scheduling).
//
// Returns the raw communities object keyed by id: { <id>: { name, group_id,
// output_channel, topics, visibility, ... } }. Callers shape/filter it as needed
// (the MCP list_communities tool returns all; the unauthenticated web route
// filters to public — see routes/communities.js).
export async function fetchCommunityConfig() {
  const base = process.env.CA_MEMBERSHIP_URL?.replace(/\/$/, '');
  const secret = process.env.CA_CONFIG_SECRET;
  if (!base || !secret) {
    throw new Error('Community config is not configured (CA_MEMBERSHIP_URL / CA_CONFIG_SECRET).');
  }
  const res = await fetch(`${base}/api/config`, { headers: { Authorization: `Bearer ${secret}` } });
  if (!res.ok) throw new Error(`Failed to fetch community config: ${res.status}`);
  const data = await res.json();
  return data.communities || {};
}
