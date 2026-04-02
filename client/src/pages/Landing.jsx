import AuthButton from '@/components/AuthButton'
import PollCreator from '@/components/PollCreator'
import { useEffect, useState } from 'react'
import { getSession } from '@/lib/api'

export default function Landing() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      {/* Header */}
      <header className="border-b border-[#e8e5df]">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#1a1a1a] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="5" height="5" rx="1" fill="#faf9f6" opacity="0.9"/>
                <rect x="9" y="2" width="5" height="5" rx="1" fill="#faf9f6" opacity="0.6"/>
                <rect x="2" y="9" width="5" height="5" rx="1" fill="#faf9f6" opacity="0.6"/>
                <rect x="9" y="9" width="5" height="5" rx="1" fill="#faf9f6" opacity="0.3"/>
              </svg>
            </div>
            <span className="text-lg font-semibold tracking-tight text-[#1a1a1a]">avails</span>
          </a>
          <AuthButton />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-6">
        {loading ? (
          <div className="flex justify-center py-32">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#1a1a1a] border-t-transparent" />
          </div>
        ) : session?.did ? (
          <div className="py-10">
            <div className="mb-8">
              <h1 className="text-2xl font-semibold text-[#1a1a1a] tracking-tight">New poll</h1>
              <p className="text-[#8a8580] mt-1">Create a scheduling poll. Share the link. Find the best time.</p>
            </div>
            <PollCreator />
          </div>
        ) : (
          <div className="py-24 max-w-xl">
            <div className="space-y-6">
              <a
                href="https://github.com/Citizen-Infra/avails"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#f0eeea] text-xs font-medium text-[#6b6560] tracking-wide uppercase hover:bg-[#e8e5df] transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
                Open source
              </a>

              <h1 className="text-[3.25rem] leading-[1.1] font-semibold text-[#1a1a1a] tracking-tight">
                Find a time<br/>
                that works<br/>
                for everyone
              </h1>

              <p className="text-lg text-[#6b6560] leading-relaxed max-w-md">
                Group scheduling on the AT Protocol. Your polls live in your
                Bluesky account. No lock-in. No account needed to respond.
              </p>

              <div className="flex items-center gap-4 pt-2">
                <AuthButton />
              </div>

              <div className="flex items-center gap-6 pt-6 text-sm text-[#a09a94]">
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="2" y="2" width="12" height="12" rx="2"/>
                    <path d="M2 6h12M6 2v12"/>
                  </svg>
                  Availability grid
                </div>
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 8h12M8 2v12"/>
                  </svg>
                  Calendar invites
                </div>
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="8" cy="8" r="6"/>
                    <path d="M8 4v4l3 2"/>
                  </svg>
                  No account to respond
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e8e5df] mt-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between text-sm text-[#a09a94]">
          <span>Built on ATProto</span>
          <a
            href="https://github.com/Citizen-Infra/avails"
            className="hover:text-[#6b6560] transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  )
}
