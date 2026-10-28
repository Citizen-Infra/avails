import { analyticsConfig } from './analyticsConfig.js'

export const CONSENT_KEY = 'avails.analytics-consent.v1'
const events = new Set(['page_viewed', 'poll_created', 'response_submitted', 'meeting_finalized'])
const pages = new Set(['home', 'poll', 'privacy', 'about', 'terms', 'standing', 'call', 'other'])
const sessionPattern = /^avails_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function pageForPath(pathname) {
  if (pathname === '/') return 'home'
  if (pathname.startsWith('/p/')) return 'poll'
  if (pathname.startsWith('/calls/')) return 'call'
  if (pathname === '/availability' || pathname === '/standing') return 'standing'
  const page = pathname.slice(1)
  return ['privacy', 'about', 'terms', 'standing'].includes(page) ? page : 'other'
}

export function createAnalytics({ enabled = false, host, projectToken, browser, send = browser?.fetch?.bind(browser) }) {
  const configured = !!(enabled && browser && send && host === 'https://us.i.posthog.com' && /^phc_[A-Za-z0-9]+$/.test(projectToken || ''))
  const listeners = new Set(), pending = new Set()
  let memoryConsent = null, sessionId = null, lastPage = null
  const read = (store, key) => { try { return browser?.[store]?.getItem(key) } catch { return null } }
  const notify = () => { for (const listener of listeners) listener() }
  function getConsent() {
    const value = memoryConsent ?? read('localStorage', CONSENT_KEY)
    return value === 'allowed' || value === 'denied' ? value : 'unknown'
  }
  function stop() {
    for (const controller of pending) controller.abort()
    pending.clear()
    sessionId = null; lastPage = null
  }
  function onStorage(event) {
    if (event.key !== CONSENT_KEY && event.key !== null) return
    memoryConsent = null
    // Respect every withdrawal transition, even if storage already holds a later
    // opt-in by the time this queued event runs. Reading only current state races.
    if (event.key === null || event.newValue !== 'allowed') stop()
    notify()
  }
  function subscribe(listener) {
    if (listeners.size === 0) browser?.addEventListener('storage', onStorage)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) browser?.removeEventListener('storage', onStorage)
    }
  }
  function setConsent(value) {
    if (value !== 'allowed' && value !== 'denied') return false
    let saved = false
    try {
      browser.localStorage.setItem(CONSENT_KEY, value)
      saved = browser.localStorage.getItem(CONSENT_KEY) === value
    } catch { /* A choice still applies to this tab when storage is blocked. */ }
    memoryConsent = saved ? null : value
    if (value === 'denied') stop()
    notify()
    return saved
  }
  function getSessionId() {
    if (sessionId) return sessionId
    // Browsers may clone sessionStorage into duplicated/opened tabs. Never adopt
    // a stored identifier: each page instance mints its own in-memory session.
    try { sessionId = `avails_${browser.crypto.randomUUID()}` } catch { return null }
    if (!sessionPattern.test(sessionId)) { sessionId = null; return null }
    return sessionId
  }
  function capture(event, properties = {}) {
    if (!configured || getConsent() !== 'allowed' || !events.has(event)) return false
    if (event === 'page_viewed') {
      if (!properties || Object.keys(properties).length !== 1 || !pages.has(properties.page)) return false
    } else if (!properties || Object.keys(properties).length !== 0) return false
    const id = getSessionId()
    if (!id) return false
    // Build from scratch: never copy URLs, API arguments/results, browser metadata,
    // error messages or arbitrary properties into an event. No SDK/autocapture.
    const payload = {
      api_key: projectToken, event, distinct_id: id,
      properties: {
        $process_person_profile: false,
        $geoip_disable: true,
        $ip: '0.0.0.0',
        ...(event === 'page_viewed' ? { page: properties.page } : {}),
      },
    }
    const controller = new AbortController()
    pending.add(controller)
    const timer = setTimeout(() => controller.abort(), 5000)
    timer.unref?.()
    const finish = () => { clearTimeout(timer); pending.delete(controller) }
    controller.signal.addEventListener('abort', finish, { once: true })
    try {
      Promise.resolve(send(`${host}/i/v0/e/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), credentials: 'omit', referrerPolicy: 'no-referrer',
        redirect: 'error', cache: 'no-store', signal: controller.signal,
      })).catch(() => {}).finally(finish)
    } catch { finish() }
    // Analytics are best-effort: no retries, queued backfill, or impact on scheduling.
    return true
  }
  function page(pathname) {
    const value = pageForPath(pathname)
    if (value === lastPage) return false
    const sent = capture('page_viewed', { page: value })
    if (sent) lastPage = value
    return sent
  }
  return { enabled: configured, getConsent, setConsent, subscribe, capture, page }
}

export const analytics = createAnalytics({ ...analyticsConfig, browser: typeof window === 'undefined' ? undefined : window })

export async function trackCompletion(promise, event) {
  const result = await promise
  try { analytics.capture(event) } catch { /* Analytics must never break a completed action. */ }
  return result
}
