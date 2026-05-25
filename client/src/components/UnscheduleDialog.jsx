import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// Replaces the multi-paragraph window.confirm() for unscheduling a meeting (#51).
// Copy preserved from the original confirm; `published` / `hasGoogleEvent` gate
// the consequence lines.
export default function UnscheduleDialog({ open, onOpenChange, onConfirm, published, hasGoogleEvent }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleConfirm() {
    setLoading(true)
    setError(null)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (err) {
      setError(err.message || 'Could not unschedule the meeting.')
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle className="text-[#1a1a1a]">Unschedule this meeting?</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-base text-[#6b6560]">
          <p>Participants with emails will get a calendar-cancel message so the event disappears from their calendars.</p>
          {published && <p>The OpenMeet event will also be deleted.</p>}
          {hasGoogleEvent && <p>The Google Calendar event will also be removed.</p>}
          <p>The poll will reopen and you can pick a different time.</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              className="border-[#e8e5df] text-[#6b6560] hover:bg-[#f0eeea] hover:text-[#1a1a1a] text-base px-5 py-2 rounded-lg"
              disabled={loading}
            >
              Keep it scheduled
            </Button>
          </DialogClose>
          <Button
            onClick={handleConfirm}
            disabled={loading}
            className="bg-red-600 text-white hover:bg-red-700 text-base px-6 py-3 rounded-lg transition-colors"
          >
            {loading ? 'Unscheduling...' : 'Unschedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
