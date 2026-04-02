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

  function handleSignOut() {
    window.location.href = '/api/auth/logout'
  }

  if (loading) {
    return <div className="h-9 w-24 animate-pulse rounded-lg bg-muted" />
  }

  if (session?.did) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">@{session.handle}</span>
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
    )
  }

  if (showInput) {
    return (
      <form onSubmit={handleSignIn} className="flex items-center gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="handle" className="sr-only">Bluesky handle</Label>
          <Input
            id="handle"
            type="text"
            placeholder="yourhandle.bsky.social"
            value={handle}
            onChange={e => setHandle(e.target.value)}
            className="h-9 w-56"
            autoFocus
          />
        </div>
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? 'Redirecting...' : 'Continue'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowInput(false)}
        >
          Cancel
        </Button>
      </form>
    )
  }

  return (
    <Button onClick={() => setShowInput(true)}>
      Sign in with Bluesky
    </Button>
  )
}
