import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
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
        timeRange: { start: earliestTime, end: latestTime },
        slotMinutes: parseInt(slotDuration, 10),
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
    <div className="w-full max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-8">

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title" className="text-sm font-medium text-[#1a1a1a]">Title <span className="text-red-500">*</span></Label>
          <Input
            id="title"
            placeholder="Team sync, coffee chat, project kickoff..."
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
            className="border-[#e8e5df] bg-white text-[#1a1a1a] placeholder:text-[#a09a94] focus-visible:ring-[#a09a94]"
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description" className="text-sm font-medium text-[#1a1a1a]">Description <span className="text-[#a09a94] text-xs font-normal">(optional)</span></Label>
          <Textarea
            id="description"
            placeholder="Any context participants should know..."
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            className="border-[#e8e5df] bg-white text-[#1a1a1a] placeholder:text-[#a09a94] focus-visible:ring-[#a09a94]"
          />
        </div>

        <div className="border-t border-[#e8e5df]" />

        {/* Date picker */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-[#1a1a1a]">
            Possible dates <span className="text-red-500">*</span>
            {selectedDates.length > 0 && (
              <span className="ml-2 text-[#a09a94] text-xs font-normal">
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
              className="rounded-lg border border-[#e8e5df] bg-white"
            />
          </div>
          {selectedDates.length > 0 && (
            <p className="text-xs text-[#8a8580]">
              {selectedDates
                .slice()
                .sort((a, b) => a - b)
                .map(d => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))
                .join(', ')}
            </p>
          )}
        </div>

        <div className="border-t border-[#e8e5df]" />

        {/* Time range + slot duration */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="earliest" className="text-sm font-medium text-[#1a1a1a]">Earliest time</Label>
            <Input
              id="earliest"
              type="time"
              value={earliestTime}
              onChange={e => setEarliestTime(e.target.value)}
              className="border-[#e8e5df] bg-white text-[#1a1a1a] focus-visible:ring-[#a09a94]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="latest" className="text-sm font-medium text-[#1a1a1a]">Latest time</Label>
            <Input
              id="latest"
              type="time"
              value={latestTime}
              onChange={e => setLatestTime(e.target.value)}
              className="border-[#e8e5df] bg-white text-[#1a1a1a] focus-visible:ring-[#a09a94]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slot-duration" className="text-sm font-medium text-[#1a1a1a]">Slot duration</Label>
            <Select value={slotDuration} onValueChange={setSlotDuration}>
              <SelectTrigger id="slot-duration" className="border-[#e8e5df] bg-white text-[#1a1a1a]">
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
        <p className="text-xs text-[#a09a94]">
          Timezone: {TIMEZONE}
        </p>

        <div className="border-t border-[#e8e5df]" />

        {/* Community */}
        {communities.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="community" className="text-sm font-medium text-[#1a1a1a]">Community <span className="text-[#a09a94] text-xs font-normal">(optional)</span></Label>
            <Select value={communityId} onValueChange={setCommunityId}>
              <SelectTrigger id="community" className="border-[#e8e5df] bg-white text-[#1a1a1a]">
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
          <Label className="text-sm font-medium text-[#1a1a1a]">Notify me after <span className="text-[#a09a94] text-xs font-normal">(optional)</span></Label>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min="1"
              placeholder="e.g. 5"
              value={notifyAfter}
              onChange={e => setNotifyAfter(e.target.value)}
              className="w-24 border-[#e8e5df] bg-white text-[#1a1a1a] placeholder:text-[#a09a94] focus-visible:ring-[#a09a94]"
            />
            <span className="text-sm text-[#8a8580]">responses</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notify-email" className="text-sm font-medium text-[#1a1a1a]">Notification email <span className="text-[#a09a94] text-xs font-normal">(optional)</span></Label>
          <Input
            id="notify-email"
            type="email"
            placeholder="you@example.com"
            value={notifyEmail}
            onChange={e => setNotifyEmail(e.target.value)}
            className="border-[#e8e5df] bg-white text-[#1a1a1a] placeholder:text-[#a09a94] focus-visible:ring-[#a09a94]"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        {/* Submit */}
        <Button type="submit" className="w-full bg-[#1a1a1a] text-[#faf9f6] hover:bg-[#333] transition-colors" disabled={submitting}>
          {submitting ? 'Creating poll...' : 'Create poll'}
        </Button>

      </form>
    </div>
  )
}
