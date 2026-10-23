import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getSession } from '@/lib/api'

export default function AuthButton() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showInput, setShowInput] = useState(false)
  const [handle, setHandle] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false))
  }, [])

  function handleSignIn(e) {
    e.preventDefault()
    if (!handle.trim()) return
    setSubmitting(true)
    const h = handle.trim().replace(/^@/, '')
    window.location.href = `/api/auth/login?handle=${encodeURIComponent(h)}`
  }

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    window.location.href = '/'
  }

  if (loading) {
    return <div className="h-9 w-24 animate-pulse rounded-lg bg-muted" />
  }

  if (session?.did) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-base text-muted-foreground">@{session.handle}</span>
        <Button variant="outline" onClick={handleSignOut} className="border-primary text-primary hover:bg-accent text-base px-5 py-2 rounded-lg">
          Sign out
        </Button>
      </div>
    )
  }

  if (showInput) {
    return (
      <form onSubmit={handleSignIn} className="flex flex-wrap items-center gap-3 max-w-full">
        <div className="flex flex-col gap-1 min-w-0 basis-full sm:basis-auto">
          <Label htmlFor="handle" className="sr-only">Bluesky handle</Label>
          <Input
            id="handle"
            type="text"
            placeholder="yourhandle.bsky.social"
            value={handle}
            onChange={e => setHandle(e.target.value)}
            className="h-11 w-full sm:w-64 text-base border-input focus-visible:ring-ring"
            autoFocus
          />
        </div>
        <Button type="submit" disabled={submitting} className="bg-primary text-primary-foreground hover:bg-primary-hover text-base px-6 py-3 rounded-lg h-11">
          {submitting ? 'Redirecting...' : 'Continue'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setShowInput(false)}
          className="text-base text-foreground-secondary hover:text-foreground"
        >
          Cancel
        </Button>
      </form>
    )
  }

  return (
    <Button onClick={() => setShowInput(true)} className="bg-primary text-primary-foreground hover:bg-primary-hover text-base px-5 py-3 rounded-lg h-auto font-semibold">
      Sign in with Bluesky
    </Button>
  )
}
