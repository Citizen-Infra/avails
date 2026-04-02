import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export default function GuestModal({ open, onOpenChange, onSubmit, submitting }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({ name: name.trim(), email: email.trim() || undefined })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-white">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-[#1a1a1a]">Continue as guest</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="guest-name" className="text-base text-[#1a1a1a]">Name</Label>
            <Input
              id="guest-name"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              className="border-[#e8e5df] text-base focus-visible:ring-[#0d9488]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="guest-email" className="text-base text-[#6b6560]">
              Email address <span className="text-[#a09a94]">(optional — for calendar invite)</span>
            </Label>
            <Input
              id="guest-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-[#e8e5df] text-base focus-visible:ring-[#0d9488]"
            />
          </div>
          <Button
            type="submit"
            disabled={!name.trim() || submitting}
            className="w-full bg-[#0d9488] text-white hover:bg-[#0f766e] text-base py-3 rounded-lg"
          >
            {submitting ? 'Saving...' : 'Save availability'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
