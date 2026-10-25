import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createMemoryRouter, matchRoutes } from 'react-router'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const app = read('src/App.jsx')
const routes = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(([, path]) => ({ path, id: path }))

test('manifest, lock and installed Router stay on the reviewed patched 7.x line', () => {
  const pkg = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  const installed = JSON.parse(read('node_modules/react-router/package.json'))
  assert.equal(pkg.dependencies['react-router'], '^7.18.4')
  assert.equal(lock.packages[''].dependencies['react-router'], pkg.dependencies['react-router'])
  assert.equal(installed.version, lock.packages['node_modules/react-router'].version)
  assert.match(installed.version, /^7\.\d+\.\d+$/)
  const [, minor, patch] = installed.version.split('.').map(Number)
  assert.ok(minor > 18 || (minor === 18 && patch >= 4))
})

test('the application retains BrowserRouter and its existing public routes', () => {
  assert.match(read('src/main.jsx'), /<BrowserRouter>/)
  assert.deepEqual(routes.map(route => route.path), [
    '/', '/about', '/privacy', '/terms', '/standing', '/calls/:id',
    '/availability', '/p/:did/:rkey', '*',
  ])
})

test('shared poll and call URLs still expose the expected decoded parameters', () => {
  const poll = matchRoutes(routes, '/p/did%3Aplc%3Asynthetic/poll%20fixture?from=shared#response').at(-1)
  assert.equal(poll.route.id, '/p/:did/:rkey')
  assert.deepEqual(poll.params, { did: 'did:plc:synthetic', rkey: 'poll fixture' })
  const call = matchRoutes(routes, '/calls/synthetic-call-123').at(-1)
  assert.deepEqual(call.params, { id: 'synthetic-call-123' })
})

test('static pages and unmatched routes keep their own route identities', () => {
  for (const path of ['/', '/about', '/privacy', '/terms', '/standing']) {
    assert.equal(matchRoutes(routes, path).at(-1).route.id, path)
  }
  assert.equal(matchRoutes(routes, '/synthetic-missing-page').at(-1).route.id, '*')
})

test('query, fragment and back/forward state survive client-side navigation', async () => {
  const router = createMemoryRouter(routes, { initialEntries: ['/'] })
  try {
    await router.navigate('/about?from=synthetic#details')
    await router.navigate('/terms')
    await router.navigate(-1)
    assert.equal(router.state.location.pathname, '/about')
    assert.equal(router.state.location.search, '?from=synthetic')
    assert.equal(router.state.location.hash, '#details')
    await router.navigate(1)
    assert.equal(router.state.location.pathname, '/terms')
  } finally { router.dispose() }
})

test('the legacy standing-availability alias retains replacement semantics', async () => {
  assert.match(app, /path="\/availability"[^\n]+<Navigate to="\/standing" replace/)
  const router = createMemoryRouter(routes, { initialEntries: ['/'] })
  try {
    await router.navigate('/availability')
    await router.navigate('/standing', { replace: true })
    await router.navigate(-1)
    assert.equal(router.state.location.pathname, '/')
  } finally { router.dispose() }
})
