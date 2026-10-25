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
        <Label htmlFor="name" className="text-base font-medium text-foreground">Your name</Label>
        <Input
          id="name"
          placeholder="Alice"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          className="border-input bg-card text-foreground text-base placeholder:text-muted-foreground focus-visible:ring-ring h-11"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email" className="text-base font-medium text-foreground">
          Email{' '}
          <span className="text-muted-foreground font-normal">(optional, for calendar invite)</span>
        </Label>
        <Input
          id="email"
          type="email"
          placeholder="alice@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border-input bg-card text-foreground text-base placeholder:text-muted-foreground focus-visible:ring-ring h-11"
        />
      </div>
      {isGoogleConfigured() && (
        <div className="space-y-1.5">
          {calendarConnected ? (
            <p className="text-base text-primary">
              Google Calendar connected — busy times shown on grid
            </p>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={handleConnectCalendar}
              disabled={calendarLoading}
              className="border-primary text-primary hover:bg-accent text-base px-5 py-2 rounded-lg"
            >
              {calendarLoading ? 'Connecting...' : 'Connect Google Calendar'}
            </Button>
          )}
          {calendarError && (
            <p className="text-sm text-destructive">{calendarError}</p>
          )}
        </div>
      )}
      <Button type="submit" disabled={!name.trim()} className="bg-primary text-primary-foreground hover:bg-primary-hover text-base px-6 py-3 rounded-lg h-auto font-semibold transition-colors">
        Add my availability
      </Button>
    </form>
  )
}
