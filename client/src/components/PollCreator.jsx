import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'

function formatDateLocal(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Calendar } from '@/components/ui/calendar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createPoll, getCommunities } from '@/lib/api'

const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

export default function PollCreator() {
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedDates, setSelectedDates] = useState([])
  const [earliestTime, setEarliestTime] = useState('09:00')
  const [latestTime, setLatestTime] = useState('17:00')
  const [slotDuration, setSlotDuration] = useState('30')
  const [communityId, setCommunityId] = useState('')
  const [notifyAfter, setNotifyAfter] = useState('')
  const [notifyEmail, setNotifyEmail] = useState('')
  const [hideResponsesUntilSubmit, setHideResponsesUntilSubmit] = useState(false)
  const [communities, setCommunities] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    getCommunities()
      .then(setCommunities)
      .catch(() => setCommunities([]))
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    if (selectedDates.length === 0) {
      setError('Select at least one date.')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        dates: selectedDates.map(formatDateLocal),
        timeRange: { start: earliestTime, end: latestTime },
        slotMinutes: parseInt(slotDuration, 10),
        timezone: TIMEZONE,
        community: communityId || undefined,
        notifyAfter: notifyAfter ? parseInt(notifyAfter, 10) : undefined,
        notifyEmail: notifyEmail.trim() || undefined,
        hideResponsesUntilSubmit: hideResponsesUntilSubmit || undefined,
      }
      const result = await createPoll(payload)
      navigate(`/p/${result.did}/${result.rkey}`)
    } catch (err) {
      setError(err.message || 'Failed to create poll.')
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-8">

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title" className="text-base font-medium text-foreground">Title <span className="text-destructive">*</span></Label>
          <Input
            id="title"
            placeholder="Team sync, coffee chat, project kickoff..."
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
            className="border-input bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-ring"
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description" className="text-base font-medium text-foreground">Description <span className="text-muted-foreground text-sm font-normal">(optional)</span></Label>
          <Textarea
            id="description"
            placeholder="Any context participants should know..."
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            className="border-input bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-ring"
          />
        </div>

        <div className="border-t border-border" />

        {/* Date picker */}
        <div className="space-y-3">
          <Label className="text-base font-medium text-foreground">
            Possible dates <span className="text-destructive">*</span>
            {selectedDates.length > 0 && (
              <span className="ml-2 text-muted-foreground text-sm font-normal">
                {selectedDates.length} selected
              </span>
            )}
          </Label>
          <div>
            <Calendar
              mode="multiple"
              selected={selectedDates}
              onSelect={setSelectedDates}
              disabled={{ before: new Date() }}
              numberOfMonths={2}
              className="rounded-sm border border-input bg-card p-4 w-full [&_table]:w-full [&_td]:p-0 [&_th]:p-0 [&_.rdp-months]:flex [&_.rdp-months]:gap-6 [&_.rdp-month]:flex-1 [&_td_button]:h-10 [&_td_button]:w-full [&_td_button]:text-base"
            />
          </div>
          {selectedDates.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {selectedDates
                .slice()
                .sort((a, b) => a - b)
                .map(d => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))
                .join(', ')}
            </p>
          )}
        </div>

        <div className="border-t border-border" />

        {/* Time range + slot duration */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="earliest" className="text-base font-medium text-foreground">Earliest time</Label>
            <Input
              id="earliest"
              type="time"
              value={earliestTime}
              onChange={e => setEarliestTime(e.target.value)}
              className="border-input bg-card text-foreground focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="latest" className="text-base font-medium text-foreground">Latest time</Label>
            <Input
              id="latest"
              type="time"
              value={latestTime}
              onChange={e => setLatestTime(e.target.value)}
              className="border-input bg-card text-foreground focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slot-duration" className="text-base font-medium text-foreground">Slot duration</Label>
            <Select value={slotDuration} onValueChange={setSlotDuration}>
              <SelectTrigger id="slot-duration" className="border-input bg-card text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="60">60 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Timezone display */}
        <p className="text-sm text-muted-foreground">
          Timezone: {TIMEZONE}
        </p>

        <div className="border-t border-border" />

        {/* Advanced options — collapsed so the core path (title, dates, time) stays light */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            aria-expanded={showAdvanced}
            className="flex flex-wrap items-center gap-2 text-base font-medium text-foreground-secondary hover:text-foreground transition-colors"
          >
            <svg className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 4l4 4-4 4" />
            </svg>
            More options
            <span className="text-sm font-normal text-muted-foreground">notifications, community, privacy</span>
          </button>

          {showAdvanced && (
            <div className="space-y-6 pt-6">
              {/* Community */}
              {communities.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="community" className="text-base font-medium text-foreground">Community <span className="text-muted-foreground text-sm font-normal">(optional)</span></Label>
                  {/* Radix forbids a SelectItem value="" — use a sentinel for "None"
                      and map it back to the empty communityId the submit path expects. */}
                  <Select value={communityId || '__none__'} onValueChange={v => setCommunityId(v === '__none__' ? '' : v)}>
                    <SelectTrigger id="community" className="border-input bg-card text-foreground">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {communities.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Notify after N responses */}
              <div className="space-y-2">
                <Label className="text-base font-medium text-foreground">Notify me after <span className="text-muted-foreground text-sm font-normal">(optional)</span></Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min="1"
                    placeholder="e.g. 5"
                    value={notifyAfter}
                    onChange={e => setNotifyAfter(e.target.value)}
                    className="w-24 border-input bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-ring"
                  />
                  <span className="text-base text-muted-foreground">responses</span>
                </div>
              </div>

              {/* Notification email */}
              <div className="space-y-2">
                <Label htmlFor="notify-email" className="text-base font-medium text-foreground">Notification email <span className="text-muted-foreground text-sm font-normal">(optional)</span></Label>
                <Input
                  id="notify-email"
                  type="email"
                  placeholder="you@example.com"
                  value={notifyEmail}
                  onChange={e => setNotifyEmail(e.target.value)}
                  className="border-input bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-ring"
                />
              </div>

              {/* Privacy option */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={hideResponsesUntilSubmit}
                  onChange={e => setHideResponsesUntilSubmit(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-ring focus:ring-offset-0 accent-primary cursor-pointer"
                />
                <span className="flex-1">
                  <span className="text-base font-medium text-foreground block">Hide other responses until people submit</span>
                  <span className="text-sm text-muted-foreground block mt-0.5">Respondents see an empty grid until they save their own availability. Prevents early picks from anchoring others.</span>
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Submit */}
        <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary-hover text-lg px-6 py-4 rounded-lg h-auto font-semibold transition-colors" disabled={submitting}>
          {submitting ? 'Creating poll...' : 'Create poll'}
        </Button>

      </form>
    </div>
  )
}
