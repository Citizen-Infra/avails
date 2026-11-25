import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { analytics, pageForPath } from '@/lib/analytics'

export default function AnalyticsConsent() {
  const { pathname } = useLocation()
  const consent = useSyncExternalStore(analytics.subscribe, analytics.getConsent, () => 'unknown')
  const [open, setOpen] = useState(false)
  const [storageWarning, setStorageWarning] = useState(false)
  const [focusSettings, setFocusSettings] = useState(false)
  const settings = useRef(null)
  const expanded = consent === 'unknown' || open

  useEffect(() => { analytics.page(pathname) }, [pathname, consent])
  useEffect(() => {
    if (focusSettings && !expanded) { settings.current?.focus(); setFocusSettings(false) }
  }, [focusSettings, expanded])

  if (!analytics.enabled) return null
  function choose(value) {
    setStorageWarning(!analytics.setConsent(value))
    setOpen(false)
    setFocusSettings(true)
  }
  const status = `${consent === 'allowed' ? 'Optional analytics are on.' : 'Optional analytics are off.'}${storageWarning ? ' Your choice could not be saved; it applies to this tab only.' : ''}`
  const pollPadding = pageForPath(pathname) === 'poll' ? 'pb-36 lg:pb-6' : ''
  return (
    <section
      aria-labelledby="analytics-heading"
      className={`border-t border-border px-4 sm:px-6 ${pollPadding} ${expanded ? 'bg-card py-6 text-foreground' : 'py-2 text-sm text-muted-foreground'}`}
    >
      {expanded ? (
        <div id="analytics-choices" className="mx-auto max-w-5xl space-y-4">
          <h2 id="analytics-heading" className="text-lg font-semibold">Optional usage analytics</h2>
          <p className="max-w-2xl text-base leading-relaxed text-foreground-secondary">
            With your permission, PostHog measures visits, poll creation, responses and finalized meetings. We don’t send poll details, availability, names, emails or account identifiers. You can change your choice here anytime. <Link to="/privacy" className="text-primary underline underline-offset-4">Privacy details</Link>
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" onClick={() => choose('denied')}>Keep analytics off</Button>
            <Button type="button" variant="outline" onClick={() => choose('allowed')}>Allow analytics</Button>
          </div>
          <p role="status" className="text-sm text-foreground-secondary">{status}</p>
        </div>
      ) : (
        <div className="mx-auto max-w-5xl flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <h2 id="analytics-heading" className="sr-only">Optional usage analytics</h2>
          <p role="status">{status}</p>
          <button
            ref={settings}
            type="button"
            aria-expanded={false}
            aria-controls="analytics-choices"
            onClick={() => setOpen(true)}
            className="underline underline-offset-4 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Change
          </button>
        </div>
      )}
    </section>
  )
}
