import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import Logo from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getSession, getCallBooking, decideCallBooking } from '@/lib/api'

export default function CallBooking() {
  const { id } = useParams()
  const [session, setSession] = useState(null)
  const [booking, setBooking] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [handle, setHandle] = useState('')

  useEffect(() => {
    let active = true
    setBooking(null)
    setError(null)
    setUncertain(false)
    setLoading(true)
    getSession().then(async (current) => {
      if (!active) return
      setSession(current?.did ? current : null)
      if (current?.did) {
        const details = await getCallBooking(id)
        if (active) setBooking(details)
      }
    }).catch((err) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  function signIn(event) {
    event.preventDefault()
    const value = handle.trim().replace(/^@/, '')
    if (!value) return
    window.location.assign(`/api/auth/login?handle=${encodeURIComponent(value)}&call=${encodeURIComponent(id)}`)
  }

  async function decide(decision) {
    setSaving(true)
    setError(null)
    try {
      setBooking(await decideCallBooking(id, decision))
    } catch (err) {
      setUncertain(true)
      setError(`${err.message}. Reload to check your saved choice before trying again.`)
    } finally { setSaving(false) }
  }

  async function switchAccount() {
    setSaving(true)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      if (!response.ok) throw new Error('Could not sign out. Reload and try again')
      window.location.reload()
    } catch (err) { setError(err.message); setSaving(false) }
  }

  const when = booking ? new Date(`${booking.slot}:00Z`) : null
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#1a1a1a]">
      <header className="border-b border-[#e8e5df] px-5 py-5 sm:px-8">
        <Link to="/" aria-label="Avails home" className="inline-flex items-center gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0d9488]">
          <Logo />
          <span className="text-xl font-semibold">Avails</span>
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-10 sm:px-8 sm:py-16">
        <h1 className="break-words text-3xl font-bold tracking-tight sm:text-4xl">{booking?.title || 'Confirm this time'}</h1>
        {loading && <p role="status" className="mt-6 text-[#6b6560]">Loading your time…</p>}
        {error && <div role="alert" className="mt-6 space-y-3">
          <p>{error}</p>
          <p className="text-[#6b6560]">Use the Bluesky account that shared availability for this call. If the link is unavailable, ask the organizer to check it.</p>
          <Button variant="outline" className="min-h-11" onClick={() => window.location.reload()}>Reload</Button>
        </div>}
        {!loading && !session && <section className="mt-6 space-y-6" aria-label="Sign in to view your time">
          <p className="leading-relaxed text-[#6b6560]">This time is private. Sign in with the Bluesky account you used to share your standing availability. Opening this link does not confirm anything.</p>
          <form onSubmit={signIn} className="space-y-3">
            <Label htmlFor="call-handle">Your Bluesky handle</Label>
            <Input id="call-handle" value={handle} onChange={(event) => setHandle(event.target.value)} autoComplete="username" placeholder="yourhandle.bsky.social" className="h-12 w-full text-base" required />
            <Button type="submit" className="min-h-12 w-full bg-[#0d9488] text-xl font-bold text-[#faf9f6] hover:bg-[#0f766e] sm:w-auto">Sign in to review this time</Button>
          </form>
        </section>}
        {booking && <section className="mt-8 space-y-8" aria-label="Your selected time">
          <div className="space-y-2 border-y border-[#e8e5df] py-6">
            <p className="text-xl font-semibold tabular-nums">{when.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}</p>
            <p className="text-[#6b6560]">{timezone} · {booking.durationMinutes} minutes</p>
          </div>
          <div role="status" aria-live="polite" className="space-y-3">
            {booking.state === 'pending' && <p className="leading-relaxed">Your availability fits this time, but you have not confirmed it. The time stays fixed whichever you choose.</p>}
            {booking.state === 'accepted' && <p className="leading-relaxed">{booking.automatic ? 'You allowed automatic booking in your standing availability, so this time is confirmed for you.' : 'You confirmed this time. Your choice is saved.'}</p>}
            {booking.state === 'declined' && <p className="leading-relaxed">You declined this time. Your choice is saved, and no calendar invitation is available for you.</p>}
            {booking.state === 'pending' && !booking.canDecide && <p>This time has already passed. Ask the organizer about another call.</p>}
          </div>
          {booking.canDecide && <div className="flex flex-col gap-3 sm:flex-row">
            <Button disabled={saving || uncertain} onClick={() => decide('accept')} className="min-h-12 bg-[#0d9488] px-6 text-xl font-bold text-[#faf9f6] hover:bg-[#0f766e]">{saving ? 'Saving your choice…' : 'Confirm this time'}</Button>
            <Button disabled={saving || uncertain} variant="outline" onClick={() => decide('decline')} className="min-h-12 px-6">Decline this time</Button>
          </div>}
          {booking.canDownload && <div className="space-y-3">
            <Button asChild variant="outline" className="min-h-12 w-full px-6 sm:w-auto"><a href={`/api/calls/${encodeURIComponent(id)}/calendar.ics`}>Download calendar file</a></Button>
            <p className="text-sm leading-relaxed text-[#6b6560]">Open the file in your calendar to add this time. Avails does not automatically add it to a connected calendar or promise an email.</p>
          </div>}
          <p className="text-sm text-[#6b6560]">Only your own choice is shown here. Contact the organizer if a saved choice needs to change.</p>
        </section>}
        {!loading && session && <div className="mt-8 space-y-3 border-t border-[#e8e5df] pt-6">
          <p className="break-words text-sm text-[#6b6560]">Signed in as {session.handle || session.did}</p>
          <Button variant="outline" disabled={saving} className="min-h-11" onClick={switchAccount}>Use a different account</Button>
        </div>}
      </main>
    </div>
  )
}
