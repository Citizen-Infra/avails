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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { finalizePoll } from '@/lib/api'

export default function FinalizeDialog({ open, onOpenChange, poll, did, rkey, onFinalized }) {
  const [dateTime, setDateTime] = useState('')
  const [duration, setDuration] = useState(60)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!dateTime) return
    setLoading(true)
    setError(null)
    try {
      await finalizePoll(did, rkey, new Date(dateTime).toISOString(), duration)
      onFinalized?.()
      onOpenChange(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule meeting</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="datetime" className="text-sm font-medium text-[#1a1a1a]">Date and time</Label>
            <Input
              id="datetime"
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              required
              className="border-[#e8e5df] bg-white text-[#1a1a1a] focus-visible:ring-[#a09a94]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="duration" className="text-sm font-medium text-[#1a1a1a]">Duration (minutes)</Label>
            <Input
              id="duration"
              type="number"
              min={15}
              step={15}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="border-[#e8e5df] bg-white text-[#1a1a1a] focus-visible:ring-[#a09a94]"
            />
          </div>
          <p className="text-sm text-[#8a8580]">
            Calendar invites will be sent to participants who provided an email.
          </p>
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="border-[#e8e5df] text-[#6b6560] hover:bg-[#f0eeea] hover:text-[#1a1a1a]">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={loading || !dateTime} className="bg-[#1a1a1a] text-[#faf9f6] hover:bg-[#333] transition-colors">
              {loading ? 'Scheduling...' : 'Schedule meeting'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
