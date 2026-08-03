// Send requests that arrive on a retired host to the live one (#150).
//
// After the OAuth move, `avails.zhgnv.com` cannot serve sign-in: clientMetadata
// builds client_id from ATPROTO_CLIENT_ID, one value shared by both hosts, so
// the old host now advertises the new host's client_id and ATProto rejects the
// mismatch. That is the same break as my-community#84. Rather than teach the
// app two identities, the retired host stops answering and forwards instead.
//
// LEGACY_HOSTS is a comma-separated list, not a single value, for the reason in
// cibc-brain D-08 — there will eventually be more than one retired host, and a
// scalar would have to be widened at exactly the wrong moment. Unset means no
// redirects, so a deploy that never sets it behaves as before.
export function legacyHostRedirect(req, res, next) {
  const hosts = (process.env.LEGACY_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0) return next();

  // req.hostname honours X-Forwarded-Host because index.js sets trust proxy,
  // which is what Railway populates. Without that this never matches in prod.
  const host = String(req.hostname || '').toLowerCase();
  if (!hosts.includes(host)) return next();

  const target = String(process.env.CLIENT_URL || '').trim().replace(/\/+$/, '');
  if (!target) return next();

  // Never redirect a host to itself. If CLIENT_URL and LEGACY_HOSTS ever name
  // the same host — a fat-fingered env var during a cutover — this would be an
  // infinite loop that takes the whole site down, which is a far worse failure
  // than the stale host it was meant to fix.
  let targetHost;
  try {
    targetHost = new URL(target).host.toLowerCase();
  } catch {
    return next();
  }
  if (targetHost === host) return next();

  // 308 rather than 301: it preserves the method and body, so a POST to /mcp
  // from an agent that still has the old host registered survives the hop.
  // A 301 would be replayed as GET by most clients and silently lose the call.
  return res.redirect(308, target + req.originalUrl);
}
