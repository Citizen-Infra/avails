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
        <Button variant="outline" onClick={handleSignOut} className="border-[#0d9488] text-[#0d9488] hover:bg-[#ccfbf1] text-base px-5 py-2 rounded-lg">
          Sign out
        </Button>
      </div>
    )
  }

  if (showInput) {
    return (
      <form onSubmit={handleSignIn} className="flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="handle" className="sr-only">Bluesky handle</Label>
          <Input
            id="handle"
            type="text"
            placeholder="yourhandle.bsky.social"
            value={handle}
            onChange={e => setHandle(e.target.value)}
            className="h-11 w-64 text-base border-[#e8e5df] focus-visible:ring-[#0d9488]"
            autoFocus
          />
        </div>
        <Button type="submit" disabled={submitting} className="bg-[#0d9488] text-white hover:bg-[#0f766e] text-base px-6 py-3 rounded-lg h-11">
          {submitting ? 'Redirecting...' : 'Continue'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setShowInput(false)}
          className="text-base text-[#6b6560] hover:text-[#1a1a1a]"
        >
          Cancel
        </Button>
      </form>
    )
  }

  return (
    <Button onClick={() => setShowInput(true)} className="bg-[#0d9488] text-white hover:bg-[#0f766e] text-lg px-8 py-4 rounded-lg h-auto font-semibold">
      Sign in with Bluesky
    </Button>
  )
}
