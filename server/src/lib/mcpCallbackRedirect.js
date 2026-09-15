export function redirectMcpClient(res, callbackUrl) {
  return res.status(302).set('Location', callbackUrl).end();
}
