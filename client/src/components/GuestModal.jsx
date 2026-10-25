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
      <DialogContent className="sm:max-w-md bg-card">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">Continue as guest</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="guest-name" className="text-base text-foreground">Name</Label>
            <Input
              id="guest-name"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              className="border-input text-base focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="guest-email" className="text-base text-foreground-secondary">
              Email address <span className="text-muted-foreground">(optional — for calendar invite)</span>
            </Label>
            <Input
              id="guest-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-input text-base focus-visible:ring-ring"
            />
          </div>
          <Button
            type="submit"
            disabled={!name.trim() || submitting}
            className="w-full bg-primary text-primary-foreground hover:bg-primary-hover text-base py-3 rounded-lg"
          >
            {submitting ? 'Saving...' : 'Save availability'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
