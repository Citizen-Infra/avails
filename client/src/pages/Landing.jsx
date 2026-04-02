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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <a href="/" className="text-lg font-semibold tracking-tight">avails</a>
          <AuthButton />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-3xl mx-auto px-4 py-10">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : session?.did ? (
          <PollCreator />
        ) : (
          <div className="text-center py-20 space-y-6">
            <h1 className="text-4xl font-bold tracking-tight">
              Find a time that works for everyone
            </h1>
            <p className="text-lg text-muted-foreground max-w-md mx-auto">
              Open-source group scheduling built on ATProto.
              Your poll lives in your Bluesky account — no lock-in.
            </p>
            <div className="flex justify-center">
              <AuthButton />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
