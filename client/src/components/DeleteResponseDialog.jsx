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

// Replaces a bare window.confirm() for deleting one's own availability (#51).
export default function DeleteResponseDialog({ open, onOpenChange, onConfirm }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleConfirm() {
    setLoading(true)
    setError(null)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (err) {
      setError(err.message || 'Could not delete your availability.')
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle className="text-foreground">Delete your availability?</DialogTitle>
        </DialogHeader>
        <p className="text-base text-foreground-secondary">
          This removes your response from this poll. The poll stays open, so you can add your availability again any time.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              className="border-input text-foreground-secondary hover:bg-muted hover:text-foreground text-base px-5 py-2 rounded-lg"
              disabled={loading}
            >
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={handleConfirm}
            disabled={loading}
            className="bg-destructive text-primary-foreground hover:bg-destructive/90 text-base px-6 py-3 rounded-lg transition-colors"
          >
            {loading ? 'Deleting...' : 'Delete availability'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
