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
    try {
      await updatePoll(did, rkey, {
        title: title.trim(),
        description: description.trim() || undefined,
        dates: selectedDates
          .slice()
          .sort((a, b) => a - b)
          .map(d => d.toISOString().slice(0, 10)),
        timeRange: { start: earliestTime, end: latestTime },
        slotMinutes: parseInt(slotDuration, 10),
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
            <Label htmlFor="edit-title" className="text-sm font-medium text-[#1a1a1a]">Title <span className="text-red-500">*</span></Label>
            <Input
              id="edit-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="border-[#e8e5df] bg-white text-[#1a1a1a] focus-visible:ring-[#a09a94]"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="edit-description" className="text-sm font-medium text-[#1a1a1a]">
              Description <span className="text-[#a09a94] text-xs font-normal">(optional)</span>
            </Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="border-[#e8e5df] bg-white text-[#1a1a1a] focus-visible:ring-[#a09a94]"
            />
          </div>

          <div className="border-t border-[#e8e5df]" />

          {/* Date picker */}
          <div className="space-y-2">
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
              <Label htmlFor="edit-earliest" className="text-sm font-medium text-[#1a1a1a]">Earliest time</Label>
              <Input
                id="edit-earliest"
                type="time"
                value={earliestTime}
                onChange={e => setEarliestTime(e.target.value)}
                className="border-[#e8e5df] bg-white text-[#1a1a1a] focus-visible:ring-[#a09a94]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-latest" className="text-sm font-medium text-[#1a1a1a]">Latest time</Label>
              <Input
                id="edit-latest"
                type="time"
                value={latestTime}
                onChange={e => setLatestTime(e.target.value)}
                className="border-[#e8e5df] bg-white text-[#1a1a1a] focus-visible:ring-[#a09a94]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-slot-duration" className="text-sm font-medium text-[#1a1a1a]">Slot duration</Label>
              <Select value={slotDuration} onValueChange={setSlotDuration}>
                <SelectTrigger id="edit-slot-duration" className="border-[#e8e5df] bg-white text-[#1a1a1a]">
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

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="border-[#e8e5df] text-[#6b6560] hover:bg-[#f0eeea] hover:text-[#1a1a1a]">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-[#1a1a1a] text-[#faf9f6] hover:bg-[#333] transition-colors">
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
