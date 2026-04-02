import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isGoogleConfigured, requestGoogleAccess, fetchBusyTimes } from '@/lib/googleCalendar'

export default function NameEntry({ onSubmit, dates = [], timezone = 'UTC', onBusySlots }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState(null)
  const [calendarConnected, setCalendarConnected] = useState(false)

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({ name: name.trim(), email: email.trim() })
  }

  async function handleConnectCalendar() {
    setCalendarLoading(true)
    setCalendarError(null)
    try {
      const accessToken = await requestGoogleAccess()
      const busySlots = await fetchBusyTimes(accessToken, dates, timezone)
      setCalendarConnected(true)
      onBusySlots?.(busySlots)
    } catch (err) {
      setCalendarError(err.message || 'Failed to connect calendar')
    } finally {
      setCalendarLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <div className="space-y-2">
        <Label htmlFor="name" className="text-base font-medium text-[#1a1a1a]">Your name</Label>
        <Input
          id="name"
          placeholder="Alice"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          className="border-[#e8e5df] bg-white text-[#1a1a1a] text-base placeholder:text-[#a09a94] focus-visible:ring-[#0d9488] h-11"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email" className="text-base font-medium text-[#1a1a1a]">
          Email{' '}
          <span className="text-[#a09a94] font-normal">(optional, for calendar invite)</span>
        </Label>
        <Input
          id="email"
          type="email"
          placeholder="alice@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border-[#e8e5df] bg-white text-[#1a1a1a] text-base placeholder:text-[#a09a94] focus-visible:ring-[#0d9488] h-11"
        />
      </div>
      {isGoogleConfigured() && (
        <div className="space-y-1.5">
          {calendarConnected ? (
            <p className="text-base text-[#0d9488]">
              Google Calendar connected — busy times shown on grid
            </p>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={handleConnectCalendar}
              disabled={calendarLoading}
              className="border-[#0d9488] text-[#0d9488] hover:bg-[#ccfbf1] text-base px-5 py-2 rounded-lg"
            >
              {calendarLoading ? 'Connecting...' : 'Connect Google Calendar'}
            </Button>
          )}
          {calendarError && (
            <p className="text-sm text-red-600">{calendarError}</p>
          )}
        </div>
      )}
      <Button type="submit" disabled={!name.trim()} className="bg-[#0d9488] text-white hover:bg-[#0f766e] text-base px-6 py-3 rounded-lg h-auto font-semibold transition-colors">
        Add my availability
      </Button>
    </form>
  )
}
