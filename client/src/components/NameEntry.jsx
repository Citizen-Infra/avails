import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function NameEntry({ onSubmit }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({ name: name.trim(), email: email.trim() })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
      <div className="space-y-1.5">
        <Label htmlFor="name">Your name</Label>
        <Input
          id="name"
          placeholder="Alice"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">
          Email{' '}
          <span className="text-muted-foreground font-normal">(optional, for calendar invite)</span>
        </Label>
        <Input
          id="email"
          type="email"
          placeholder="alice@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={!name.trim()}>
        Add my availability
      </Button>
    </form>
  )
}
