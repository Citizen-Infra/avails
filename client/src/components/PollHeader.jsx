import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export default function PollHeader({ poll, did, rkey, isCreator, onEditClick }) {
  const [copied, setCopied] = useState(false)

  function copyLink() {
    const url = `${window.location.origin}/p/${did}/${rkey}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const isOpen = !poll.finalTime
  const status = isOpen ? 'open' : 'closed'

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight flex-1 min-w-0">
          {poll.title}
        </h1>
        <Badge variant={isOpen ? 'default' : 'secondary'} className="shrink-0 mt-1">
          {status}
        </Badge>
      </div>

      {poll.description && (
        <p className="text-muted-foreground">{poll.description}</p>
      )}

      <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
        {poll.timezone && (
          <span>{poll.timezone}</span>
        )}
        {poll.community && (
          <Badge variant="outline">{poll.community}</Badge>
        )}
        <Button variant="outline" size="sm" onClick={copyLink}>
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
        {isCreator && isOpen && onEditClick && (
          <Button variant="outline" size="sm" onClick={onEditClick}>
            Edit poll
          </Button>
        )}
      </div>
    </div>
  )
}
