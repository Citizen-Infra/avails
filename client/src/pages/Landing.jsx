import AuthButton from '@/components/AuthButton'
import Logo from '@/components/Logo'
import PollCreator from '@/components/PollCreator'
import { Card, CardContent } from '@/components/ui/card'
import { useEffect, useState } from 'react'
import { getSession, getMyPolls } from '@/lib/api'

function formatDates(dates) {
  if (!dates || dates.length === 0) return null
  const sorted = [...dates].sort()
  const fmt = (iso) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  if (sorted.length === 1) return fmt(sorted[0])
  return `${fmt(sorted[0])} – ${fmt(sorted[sorted.length - 1])}`
}

function PollCard({ poll }) {
  const isScheduled = !!poll.finalTime
  const datesSummary = formatDates(poll.dates)

  return (
    <a href={`/p/${poll.did}/${poll.rkey}`} className="block group">
      <Card className="border-border bg-card ring-0 shadow-none hover:border-primary transition-colors rounded-lg py-0">
        <CardContent className="px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-medium text-foreground break-words group-hover:text-primary">
                {poll.title}
              </p>
              {datesSummary && (
                <p className="text-sm text-muted-foreground mt-0.5">{datesSummary}</p>
              )}
            </div>
            <span className={`shrink-0 text-sm px-3 py-1 rounded-full font-medium ${
              isScheduled
                ? 'bg-muted text-muted-foreground'
                : 'bg-accent text-primary'
            }`}>
              {isScheduled ? 'Scheduled' : 'Open'}
            </span>
          </div>
        </CardContent>
      </Card>
    </a>
  )
}

export default function Landing() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [polls, setPolls] = useState([])
  const [pollsLoading, setPollsLoading] = useState(false)

  useEffect(() => {
    getSession()
      .then((s) => {
        setSession(s)
        if (s?.did) {
          setPollsLoading(true)
          getMyPolls()
            .then((data) => setPolls(data.polls || []))
            .catch(() => setPolls([]))
            .finally(() => setPollsLoading(false))
        }
      })
      .catch(() => setSession(null))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="avails-landing min-h-screen">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <a href="/" className="flex items-center gap-2 shrink-0">
            <Logo size={32} />
            <span className="text-xl font-bold tracking-tight text-foreground">Avails</span>
          </a>
          <div className="flex items-center gap-3 sm:gap-6 min-w-0">
            {/* "Standing availability", not "Availability": the page's own h1
                says the former, and so does the link to it further down this
                page. Everything here is availability, so the bare noun named
                the destination with the one word that told you nothing about
                it. nowrap because two words must not wrap in a 64px header. */}
            {session?.did && (
              <a href="/standing" className="hidden sm:block whitespace-nowrap text-base text-foreground-secondary hover:text-foreground transition-colors">Standing availability</a>
            )}
            <a href="/about" className="hidden sm:block text-base text-foreground-secondary hover:text-foreground transition-colors">About</a>
            <AuthButton />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-6">
        {loading ? (
          <div className="flex justify-center py-32">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
          </div>
        ) : session?.did ? (
          <div className="py-10 space-y-12">
            {/* My Polls */}
            <div>
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-xl font-semibold text-foreground tracking-tight">My polls</h2>
                <a href="/standing" className="text-sm font-medium text-primary hover:text-primary-hover transition-colors">
                  Set standing availability →
                </a>
              </div>
              {pollsLoading ? (
                <div className="flex items-center gap-2 text-base text-muted-foreground py-2">
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                  Loading…
                </div>
              ) : polls.length === 0 ? (
                <p className="text-base text-muted-foreground">No polls yet — create your first one below.</p>
              ) : (() => {
                const active = polls.filter((p) => !p.finalTime)
                const completed = polls.filter((p) => !!p.finalTime)
                return (
                  <div className="space-y-6">
                    {active.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-primary uppercase tracking-wide mb-2">Active</p>
                        <div className="space-y-2">
                          {active.map((p) => <PollCard key={p.uri} poll={p} />)}
                        </div>
                      </div>
                    )}
                    {completed.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-primary uppercase tracking-wide mb-2">Completed</p>
                        <div className="space-y-2">
                          {completed.map((p) => <PollCard key={p.uri} poll={p} />)}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* New Poll */}
            <div>
              <div className="mb-8">
                <h1 className="text-3xl font-semibold text-foreground tracking-tight">New poll</h1>
                <p className="text-lg text-foreground-secondary mt-1">Create a scheduling poll. Share the link. Find the best time.</p>
              </div>
              <PollCreator />
            </div>
          </div>
        ) : (
          <div className="py-24 max-w-2xl">
            <div className="space-y-6">
              <h1 className="leading-[1.1] font-bold text-foreground tracking-tight">
                Find a time your whole group can actually meet
              </h1>

              <p className="text-lg sm:text-xl text-foreground-secondary leading-relaxed max-w-lg">
                Avails is a free, open scheduling poll for groups. Share a link,
                everyone marks when they're free, and you pick the time that
                works for the most people. No accounts to chase, and your data
                stays yours.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <AuthButton />
                <a
                  href="https://github.com/Citizen-Infra/avails"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 py-2 text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                  </svg>
                  Open source
                </a>
              </div>

              <div className="flex flex-wrap items-start gap-3 sm:gap-8 pt-6 text-base text-foreground-secondary">
                <div className="flex items-center gap-2.5">
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary shrink-0">
                    <circle cx="8" cy="8" r="6"/>
                    <path d="M5 8.5l2 2 4-4"/>
                  </svg>
                  Respond without logging in
                </div>
                <div className="flex items-center gap-2.5">
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary shrink-0">
                    <path d="M4 8h8M8 4v8M2 2h4M10 2h4M2 14h4M10 14h4"/>
                  </svg>
                  Free & open source
                </div>
                <div className="flex items-center gap-2.5">
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary shrink-0">
                    <rect x="3" y="5" width="10" height="8" rx="1.5"/>
                    <path d="M5 5V3.5a3 3 0 016 0V5"/>
                  </svg>
                  Your data stays yours
                </div>
                <div className="flex items-center gap-2.5">
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary shrink-0">
                    <path d="M5 3l-1 10M12 3l-1 10M3 6h11M2 10h11"/>
                  </svg>
                  Works with Claude & MCP tools
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm sm:text-base text-muted-foreground">
          <span>Built on ATProto</span>
          <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
            <a href="/about" className="hover:underline transition-colors">About</a>
            <a href="/privacy" className="hover:underline transition-colors">Privacy</a>
            <a href="/terms" className="hover:underline transition-colors">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
