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
  const pollPadding = pageForPath(pathname) === 'poll' ? 'pb-36 lg:pb-6' : ''
  return (
    <section aria-labelledby="analytics-heading" className={`border-t border-border bg-card px-6 py-6 text-foreground ${pollPadding}`}>
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h2 id="analytics-heading" className="text-lg font-semibold">Optional usage analytics</h2>
          {!expanded && (
            <Button ref={settings} type="button" variant="outline" aria-expanded={false} aria-controls="analytics-choices" onClick={() => setOpen(true)}>
              Change analytics preference
            </Button>
          )}
        </div>
        {expanded && (
          <div id="analytics-choices" className="space-y-4">
            <p className="max-w-2xl text-base leading-relaxed text-foreground-secondary">
              With your permission, PostHog measures visits, poll creation, responses and finalized meetings. We don’t send poll details, availability, names, emails or account identifiers. You can change your choice here anytime. <Link to="/privacy" className="text-primary underline underline-offset-4">Privacy details</Link>
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" onClick={() => choose('denied')}>Keep analytics off</Button>
              <Button type="button" variant="outline" onClick={() => choose('allowed')}>Allow analytics</Button>
            </div>
          </div>
        )}
        <p role="status" className="text-sm text-foreground-secondary">
          {consent === 'allowed' ? 'Optional analytics are on.' : 'Optional analytics are off.'}
          {storageWarning && ' Your choice could not be saved; it applies to this tab only.'}
        </p>
      </div>
    </section>
  )
}
