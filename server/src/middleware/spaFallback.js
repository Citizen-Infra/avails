import path from 'path';

// Catch-all that serves the built SPA shell for client routes.
//
// Extracted from index.js so it can be tested — index.js calls start() on
// import, so anything inline there is unreachable from a test.
//
// An /api path reaching here matched no route, so it must 404. Returning
// without responding (and without next()) leaves Express holding the request
// in-flight with nothing left to run: it hangs until the client gives up while
// the socket stays open, which is what #109 was. JSON matches the error
// handler in index.js, which already answers /api failures with { error }.
export function spaFallback(clientDist) {
  return (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  };
}
