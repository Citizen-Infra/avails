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
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle className="text-[#1a1a1a]">Delete this poll?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[#6b6560]">
          This will permanently remove the poll and all responses from your PDS. This cannot be undone.
        </p>
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              className="border-[#e8e5df] text-[#6b6560] hover:bg-[#f0eeea] hover:text-[#1a1a1a]"
              disabled={loading}
            >
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={handleDelete}
            disabled={loading}
            className="bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            {loading ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
