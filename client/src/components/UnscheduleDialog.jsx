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
// Copy preserved from the original confirm; `hasGoogleEvent` gates the
// provider-specific consequence line.
export default function UnscheduleDialog({ open, onOpenChange, onConfirm, hasGoogleEvent }) {
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
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle className="text-foreground">Unschedule this meeting?</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-base text-foreground-secondary">
          <p>Participants with emails will get a calendar-cancel message so the event disappears from their calendars.</p>
          {hasGoogleEvent && <p>The Google Calendar event will also be removed.</p>}
          <p>The poll will reopen and you can pick a different time.</p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              className="border-input text-foreground-secondary hover:bg-muted hover:text-foreground text-base px-5 py-2 rounded-lg"
              disabled={loading}
            >
              Keep it scheduled
            </Button>
          </DialogClose>
          <Button
            onClick={handleConfirm}
            disabled={loading}
            className="bg-destructive text-primary-foreground hover:bg-destructive/90 text-base px-6 py-3 rounded-lg transition-colors"
          >
            {loading ? 'Unscheduling...' : 'Unschedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
