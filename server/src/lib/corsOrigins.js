// The CORS allowlist, split out from CLIENT_URL (#151).
//
// CLIENT_URL keeps its other two jobs — redirect targets and links in outbound
// email — and both want the NEW host the moment the migration starts. CORS
// wants to accept the OLD one as well until every caller has moved. One string
// cannot hold both answers, so whichever value you pick is wrong for one job.
//
// Same shape as community-admin's CA_ACCEPTED_DIDS (community-admin#99) and the
// MC_EXTENSION_REDIRECT allowlist (community-admin#110): the server accepts a
// list while clients move at their own pace, so there is no cutover moment.
// Drop the old entry from CORS_ORIGINS once nothing calls it.

// Origin headers never carry a trailing slash or a path, but CLIENT_URL is
// hand-written and regularly does ("https://avails.citizeninfra.org/"), which
// would otherwise silently never match any request. Comparing `.origin` rather
// than the raw string is what fixes that: it is scheme + host + port and nothing
// else, so the two spellings collapse to one value.
function normalize(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    // Not a URL at all — a typo'd entry. Return it as written so it simply
    // fails to match, rather than throwing on every request.
    return trimmed;
  }
}

// CLIENT_URL is always allowed, so a deploy that never sets CORS_ORIGINS behaves
// exactly as it did before this change.
export function corsOrigins() {
  const extra = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(normalize)
    .filter(Boolean);
  const client = normalize(process.env.CLIENT_URL || 'http://localhost:5173');
  return [...new Set([client, ...extra].filter(Boolean))];
}

// The `cors` package's origin callback. Passing a function rather than a fixed
// string is what makes the `vary: Origin` header true: the allowed origin is now
// echoed from the request instead of being one constant sent to every caller.
export function corsOriginCheck(origin, callback) {
  // No Origin header: same-origin navigation, curl, or a server-to-server call.
  // CORS does not apply, and the avails web app itself arrives this way because
  // it is served from the same Railway service as the API.
  if (!origin) return callback(null, true);
  // `false` omits the header and lets the browser refuse. Calling back with an
  // Error would turn a routine cross-origin request into a 500 instead.
  callback(null, corsOrigins().includes(normalize(origin)));
}
