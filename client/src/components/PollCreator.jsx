import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
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
  const [communities, setCommunities] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

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
        dates: selectedDates.map(d => d.toISOString().slice(0, 10)),
        earliestTime,
        latestTime,
        slotDuration: parseInt(slotDuration, 10),
        timezone: TIMEZONE,
        communityId: communityId || undefined,
        notifyAfter: notifyAfter ? parseInt(notifyAfter, 10) : undefined,
        notifyEmail: notifyEmail.trim() || undefined,
      }
      const result = await createPoll(payload)
      navigate(`/p/${result.did}/${result.rkey}`)
    } catch (err) {
      setError(err.message || 'Failed to create poll.')
      setSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>New availability poll</CardTitle>
        <CardDescription>
          Fill in the details below. Participants will see all options on one page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title <span className="text-destructive">*</span></Label>
            <Input
              id="title"
              placeholder="Team sync, coffee chat, project kickoff..."
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              id="description"
              placeholder="Any context participants should know..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <Separator />

          {/* Date picker */}
          <div className="space-y-2">
            <Label>
              Possible dates <span className="text-destructive">*</span>
              {selectedDates.length > 0 && (
                <span className="ml-2 text-muted-foreground text-xs font-normal">
                  {selectedDates.length} selected
                </span>
              )}
            </Label>
            <div className="flex justify-center">
              <Calendar
                mode="multiple"
                selected={selectedDates}
                onSelect={setSelectedDates}
                disabled={{ before: new Date() }}
                className="rounded-lg border"
              />
            </div>
            {selectedDates.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedDates
                  .slice()
                  .sort((a, b) => a - b)
                  .map(d => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))
                  .join(', ')}
              </p>
            )}
          </div>

          <Separator />

          {/* Time range + slot duration */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="earliest">Earliest time</Label>
              <Input
                id="earliest"
                type="time"
                value={earliestTime}
                onChange={e => setEarliestTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="latest">Latest time</Label>
              <Input
                id="latest"
                type="time"
                value={latestTime}
                onChange={e => setLatestTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slot-duration">Slot duration</Label>
              <Select value={slotDuration} onValueChange={setSlotDuration}>
                <SelectTrigger id="slot-duration">
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
          <p className="text-xs text-muted-foreground">
            Timezone: {TIMEZONE}
          </p>

          <Separator />

          {/* Community */}
          {communities.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="community">Community <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Select value={communityId} onValueChange={setCommunityId}>
                <SelectTrigger id="community">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {communities.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Notify after N responses */}
          <div className="space-y-2">
            <Label>Notify me after <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min="1"
                placeholder="e.g. 5"
                value={notifyAfter}
                onChange={e => setNotifyAfter(e.target.value)}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">responses</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notify-email">Notification email <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              id="notify-email"
              type="email"
              placeholder="you@example.com"
              value={notifyEmail}
              onChange={e => setNotifyEmail(e.target.value)}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {/* Submit */}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Creating poll...' : 'Create poll'}
          </Button>

        </form>
      </CardContent>
    </Card>
  )
}
