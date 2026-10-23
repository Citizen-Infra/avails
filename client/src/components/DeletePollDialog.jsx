import { useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { deletePoll } from '@/lib/api'

export default function DeletePollDialog({ open, onOpenChange, did, rkey }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleDelete() {
    setLoading(true)
    setError(null)
    try {
      await deletePoll(did, rkey)
      onOpenChange(false)
      navigate('/')
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle className="text-foreground">Delete this poll?</DialogTitle>
        </DialogHeader>
        <p className="text-base text-foreground-secondary">
          This will permanently remove the poll and all responses from your PDS. This cannot be undone.
        </p>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
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
            onClick={handleDelete}
            disabled={loading}
            className="bg-destructive text-primary-foreground hover:bg-destructive/90 text-base px-6 py-3 rounded-lg transition-colors"
          >
            {loading ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
