// The public URL of a poll page.
//
// One helper because this path is a contract with the client router — the route
// is `/p/:did/:rkey` (client/src/App.jsx) and anything else falls through to the
// catch-all NotFound route. The MCP tools built it correctly; the three REST
// call sites had drifted to `/poll/`, so every scheduling email, every
// cancellation email, and the URL embedded in both .ics files pointed at a
// 404 (#130). A calendar invite outlives the email that carried it, so the dead
// link stays in people's calendars.
//
// The trailing-slash strip is not decoration: CLIENT_URL is hand-entered in
// Railway, and `https://host/` + `/p/...` would produce a double slash.
// legacyHostRedirect.js strips it for the same reason.
export function pollUrl(did, rkey) {
  const base = String(process.env.CLIENT_URL || 'http://localhost:5173')
    .trim()
    .replace(/\/+$/, '');
  return `${base}/p/${did}/${rkey}`;
}
