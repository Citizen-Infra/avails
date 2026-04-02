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
    <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
      <div className="space-y-1.5">
        <Label htmlFor="name">Your name</Label>
        <Input
          id="name"
          placeholder="Alice"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">
          Email{' '}
          <span className="text-muted-foreground font-normal">(optional, for calendar invite)</span>
        </Label>
        <Input
          id="email"
          type="email"
          placeholder="alice@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {isGoogleConfigured() && (
        <div className="space-y-1.5">
          {calendarConnected ? (
            <p className="text-sm text-green-600 dark:text-green-400">
              Google Calendar connected — busy times shown on grid
            </p>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={handleConnectCalendar}
              disabled={calendarLoading}
            >
              {calendarLoading ? 'Connecting...' : 'Connect Google Calendar'}
            </Button>
          )}
          {calendarError && (
            <p className="text-sm text-destructive">{calendarError}</p>
          )}
        </div>
      )}
      <Button type="submit" disabled={!name.trim()}>
        Add my availability
      </Button>
    </form>
  )
}
