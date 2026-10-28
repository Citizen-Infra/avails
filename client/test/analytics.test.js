import test from 'node:test'
import assert from 'node:assert/strict'
import { createAnalytics, pageForPath, CONSENT_KEY } from '../src/lib/analytics.js'

const first = '12345678-1234-4123-8123-123456789abc'
const second = '22345678-1234-4123-8123-123456789abc'
function fixture(overrides = {}) {
  const storage = () => {
    const values = new Map()
    return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  }
  const requests = [], listeners = new Set()
  let ids = 0
  const browser = {
    localStorage: storage(), sessionStorage: storage(), crypto: { randomUUID: () => ids++ ? second : first },
    addEventListener: (name, callback) => { assert.equal(name, 'storage'); listeners.add(callback) },
    removeEventListener: (name, callback) => listeners.delete(callback),
  }
  const send = (url, options) => { requests.push({ url, options, payload: JSON.parse(options.body) }); return Promise.resolve({ ok: true }) }
  const client = createAnalytics({ enabled: true, host: 'https://us.i.posthog.com', projectToken: 'phc_fixture', browser, send, ...overrides })
  return { client, browser, requests, listeners, storageEvent: (key, newValue = null) => { for (const listener of listeners) listener({ key, newValue }) } }
}

test('fresh and declined visitors produce no requests or analytics identifiers', () => {
  const f = fixture()
  assert.equal(f.client.getConsent(), 'unknown')
  assert.equal(f.client.page('/p/did:plc:PRIVATE/PRIVATE_POLL'), false)
  assert.equal(f.client.capture('poll_created'), false)
  assert.equal(f.requests.length, 0); assert.equal(f.browser.sessionStorage.values.size, 0)
  assert.equal(f.browser.localStorage.values.size, 0)
  f.client.setConsent('denied')
  assert.equal(f.client.capture('response_submitted'), false)
  assert.equal(f.requests.length, 0); assert.equal(f.browser.sessionStorage.values.size, 0)
})

test('explicit consent emits only fixed event schema, no cookies or referrer, to confirmed US ingestion', () => {
  const f = fixture(); assert.equal(f.client.setConsent('allowed'), true)
  assert.equal(f.requests.length, 0, 'consent itself sends nothing')
  assert.equal(f.browser.sessionStorage.values.size, 0, 'identifier created only for a permitted event')
  f.client.page('/p/did:plc:PRIVATE/PRIVATE_POLL')
  const { url, options, payload } = f.requests[0]
  assert.equal(url, 'https://us.i.posthog.com/i/v0/e/')
  assert.deepEqual(payload, { api_key: 'phc_fixture', event: 'page_viewed', distinct_id: `avails_${first}`, properties: { $process_person_profile: false, $geoip_disable: true, $ip: '0.0.0.0', page: 'poll' } })
  assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer')
  assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store')
  assert.equal(options.keepalive, undefined); assert.equal(options.method, 'POST')
  assert.doesNotMatch(options.body, /PRIVATE|did:plc|current_url|referrer|user_agent|email|name|slots/)
})

test('only approved events and fixed properties can leave the boundary', () => {
  const f = fixture(); f.client.setConsent('allowed')
  for (const event of ['identify', '$identify', '$autocapture', '$snapshot', '$pageview', 'error', 'private']) assert.equal(f.client.capture(event), false)
  for (const props of [{ email: 'PRIVATE@example.test' }, { page: 'PRIVATE' }, { page: 'home', url: 'PRIVATE' }, null]) {
    assert.equal(f.client.capture('poll_created', props), false)
    assert.equal(f.client.capture('page_viewed', props), false)
  }
  for (const event of ['poll_created', 'response_submitted', 'meeting_finalized']) assert.equal(f.client.capture(event), true)
  assert.equal(f.requests.length, 3)
  for (const request of f.requests) assert.deepEqual(Object.keys(request.payload.properties).sort(), ['$geoip_disable', '$ip', '$process_person_profile'].sort())
})

test('coarse routes exclude identifiers, query strings, fragments and unknown static paths', () => {
  for (const [path, page] of [['/', 'home'], ['/p/private/private', 'poll'], ['/calls/private', 'call'], ['/availability', 'standing'], ['/privacy', 'privacy'], ['/about', 'about'], ['/terms', 'terms'], ['/standing', 'standing'], ['/poll', 'other'], ['/home', 'other'], ['/PRIVATE?email=PRIVATE#PRIVATE', 'other']]) assert.equal(pageForPath(path), page)
})

test('pageview effects deduplicate StrictMode/coarse-page repeats but count route changes', () => {
  const f = fixture(); f.client.page('/'); f.client.setConsent('allowed')
  assert.equal(f.client.page('/'), true); assert.equal(f.client.page('/'), false)
  assert.equal(f.client.page('/p/private/one'), true); assert.equal(f.client.page('/p/private/two'), false)
  assert.equal(f.client.page('/privacy'), true)
  assert.equal(f.requests.length, 3)
})

test('withdrawal aborts pending requests, drops session ID and suppresses later events without backfill', () => {
  const requests = []
  const f = fixture({ send: (url, options) => { requests.push(options); return new Promise(() => {}) } })
  f.client.setConsent('allowed'); f.client.page('/')
  assert.equal(requests[0].signal.aborted, false)
  assert.equal(f.browser.sessionStorage.values.size, 0, 'identifiers remain only in page memory')
  f.client.setConsent('denied')
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(f.browser.sessionStorage.values.size, 0)
  assert.equal(f.client.capture('poll_created'), false)
  f.client.setConsent('allowed'); f.client.page('/')
  assert.notEqual(JSON.parse(requests[1].body).distinct_id, JSON.parse(requests[0].body).distinct_id)
  f.client.setConsent('denied')
})

test('another tab declining or clearing storage revokes this tab too', () => {
  for (const key of [CONSENT_KEY, null]) {
    const f = fixture(); let notifications = 0
    const unsubscribe = f.client.subscribe(() => notifications++)
    f.client.setConsent('allowed'); f.client.page('/')
    f.browser.localStorage.removeItem(CONSENT_KEY); f.storageEvent(key)
    assert.equal(f.client.getConsent(), 'unknown')
    assert.equal(f.client.capture('meeting_finalized'), false)
    assert.equal(f.browser.sessionStorage.values.size, 0)
    assert.equal(notifications, 2)
    unsubscribe(); assert.equal(f.listeners.size, 0)
  }
})

test('consent survives reload but the in-memory session identifier does not', () => {
  const f = fixture(); f.client.setConsent('allowed'); f.client.page('/')
  const replay = createAnalytics({ enabled: true, host: 'https://us.i.posthog.com', projectToken: 'phc_fixture', browser: f.browser, send: (url, options) => { f.requests.push({ payload: JSON.parse(options.body) }); return Promise.resolve({ ok: true }) } })
  replay.page('/privacy')
  assert.notEqual(f.requests[0].payload.distinct_id, f.requests[1].payload.distinct_id)
  assert.deepEqual([...f.browser.localStorage.values.keys()], [CONSENT_KEY])
  assert.equal(f.browser.sessionStorage.values.size, 0)
})

test('rapid cross-tab denied then allowed still aborts the old session before minting another', () => {
  const requests = []
  const f = fixture({ send: (url, options) => { requests.push(options); return new Promise(() => {}) } })
  const unsubscribe = f.client.subscribe(() => {})
  f.client.setConsent('allowed'); f.client.page('/')
  f.browser.localStorage.setItem(CONSENT_KEY, 'allowed')
  f.storageEvent(CONSENT_KEY, 'denied')
  assert.equal(requests[0].signal.aborted, true, 'queued withdrawal cannot be skipped by a later stored opt-in')
  f.storageEvent(CONSENT_KEY, 'allowed'); f.client.page('/')
  assert.notEqual(JSON.parse(requests[0].body).distinct_id, JSON.parse(requests[1].body).distinct_id)
  f.client.setConsent('denied'); unsubscribe()
})

test('new pages never adopt identifiers from copied sessionStorage', () => {
  const f = fixture(); f.client.setConsent('allowed'); f.client.page('/')
  const copied = fixture(); copied.browser.crypto.randomUUID = () => second
  copied.browser.localStorage.setItem(CONSENT_KEY, 'allowed')
  copied.browser.sessionStorage.setItem('avails.analytics-session.v1', f.requests[0].payload.distinct_id)
  copied.client.page('/')
  assert.notEqual(copied.requests[0].payload.distinct_id, f.requests[0].payload.distinct_id)
  assert.equal(copied.requests[0].payload.distinct_id, `avails_${second}`)
})

test('blocked storage permits an explicit current-tab choice, never guesses consent', () => {
  const f = fixture()
  Object.defineProperty(f.browser, 'localStorage', { get() { throw new Error('blocked') } })
  Object.defineProperty(f.browser, 'sessionStorage', { get() { throw new Error('blocked') } })
  assert.equal(f.client.getConsent(), 'unknown'); assert.equal(f.client.page('/'), false)
  assert.equal(f.client.setConsent('allowed'), false)
  assert.equal(f.client.page('/'), true)
  f.client.setConsent('denied'); assert.equal(f.client.page('/privacy'), false)
})

test('invalid consent never enables tracking', () => {
  const f = fixture()
  f.browser.localStorage.setItem(CONSENT_KEY, 'true')
  assert.equal(f.client.setConsent('true'), false); assert.equal(f.client.getConsent(), 'unknown')
  assert.equal(f.client.capture('poll_created'), false)
})

test('bad configuration or unavailable secure randomness fails closed', () => {
  for (const override of [{ enabled: false }, { projectToken: '' }, { projectToken: 'phx_PRIVATE' }, { host: 'https://unapproved.example.test' }, { browser: undefined }]) {
    const f = fixture(override); assert.equal(f.client.enabled, false)
    assert.equal(f.client.capture('poll_created'), false); assert.equal(f.requests.length, 0)
  }
  const f = fixture(); f.client.setConsent('allowed'); f.browser.crypto = undefined
  assert.equal(f.client.capture('poll_created'), false)
})

test('network rejection and synchronous transport failure stay best-effort and never retry', async () => {
  for (const send of [() => Promise.reject(new Error('blocked')), () => { throw new Error('blocked') }]) {
    const f = fixture({ send }); f.client.setConsent('allowed')
    assert.doesNotThrow(() => f.client.capture('poll_created'))
  }
  await new Promise(resolve => setImmediate(resolve))
})
