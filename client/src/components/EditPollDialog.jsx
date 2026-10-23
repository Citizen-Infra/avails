import { useState } from 'react'
import { updatePoll } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Calendar } from '@/components/ui/calendar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

// Parse "YYYY-MM-DD" strings into local Date objects for the calendar
function parseDateStr(str) {
  const [year, month, day] = str.split('-').map(Number)
  return new Date(year, month - 1, day)
}

// Format Date to "YYYY-MM-DD" using LOCAL time (not UTC — avoids timezone shift)
function formatDateLocal(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function EditPollDialog({ open, onOpenChange, poll, did, rkey, onSaved }) {
  const [title, setTitle] = useState(poll.title || '')
  const [description, setDescription] = useState(poll.description || '')

  const initialDates = (poll.dates || []).map(parseDateStr)
  const [selectedDates, setSelectedDates] = useState(initialDates)

  const timeRange = poll.timeRange || { start: poll.earliestTime || '09:00', end: poll.latestTime || '17:00' }
  const [earliestTime, setEarliestTime] = useState(timeRange.start)
  const [latestTime, setLatestTime] = useState(timeRange.end)

  const existingSlotMinutes = poll.slotMinutes || poll.slotDuration || 30
  const [slotDuration, setSlotDuration] = useState(String(existingSlotMinutes))

  const [hideResponsesUntilSubmit, setHideResponsesUntilSubmit] = useState(!!poll.hideResponsesUntilSubmit)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave() {
    setError(null)

    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    if (selectedDates.length === 0) {
      setError('Select at least one date.')
      return
    }

    setSaving(true)
    const sortedDates = selectedDates.slice().sort((a, b) => a - b).map(formatDateLocal)
    try {
      await updatePoll(did, rkey, {
        title: title.trim(),
        description: description.trim() || undefined,
        dates: sortedDates,
        timeRange: { start: earliestTime, end: latestTime },
        slotMinutes: parseInt(slotDuration, 10),
        hideResponsesUntilSubmit,
      })
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(err.message || 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit poll</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="edit-title" className="text-base font-medium text-foreground">Title <span className="text-destructive">*</span></Label>
            <Input
              id="edit-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="border-input bg-card text-foreground focus-visible:ring-ring"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="edit-description" className="text-base font-medium text-foreground">
              Description <span className="text-muted-foreground text-sm font-normal">(optional)</span>
            </Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="border-input bg-card text-foreground focus-visible:ring-ring"
            />
          </div>

          <div className="border-t border-border" />

          {/* Date picker */}
          <div className="space-y-2">
            <Label className="text-base font-medium text-foreground">
              Possible dates <span className="text-destructive">*</span>
              {selectedDates.length > 0 && (
                <span className="ml-2 text-muted-foreground text-sm font-normal">
                  {selectedDates.length} selected
                </span>
              )}
            </Label>
            <div className="flex justify-center">
              <Calendar
                mode="multiple"
                selected={selectedDates}
                onSelect={setSelectedDates}
                className="rounded-sm border border-input bg-card"
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
              <Label htmlFor="edit-earliest" className="text-base font-medium text-foreground">Earliest time</Label>
              <Input
                id="edit-earliest"
                type="time"
                value={earliestTime}
                onChange={e => setEarliestTime(e.target.value)}
                className="border-input bg-card text-foreground focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-latest" className="text-base font-medium text-foreground">Latest time</Label>
              <Input
                id="edit-latest"
                type="time"
                value={latestTime}
                onChange={e => setLatestTime(e.target.value)}
                className="border-input bg-card text-foreground focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-slot-duration" className="text-base font-medium text-foreground">Slot duration</Label>
              <Select value={slotDuration} onValueChange={setSlotDuration}>
                <SelectTrigger id="edit-slot-duration" className="border-input bg-card text-foreground">
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

          <div className="border-t border-border" />

          {/* Privacy option */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={hideResponsesUntilSubmit}
              onChange={e => setHideResponsesUntilSubmit(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-ring focus:ring-offset-0 accent-primary cursor-pointer"
            />
            <span className="flex-1">
              <span className="text-base font-medium text-foreground block">Hide other responses until people submit</span>
              <span className="text-sm text-muted-foreground block mt-0.5">Respondents see an empty grid until they save their own availability.</span>
            </span>
          </label>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="border-input text-foreground-secondary hover:bg-muted hover:text-foreground text-base px-5 py-2 rounded-lg">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary-hover text-base px-6 py-3 rounded-lg transition-colors">
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
