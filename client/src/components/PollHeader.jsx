import { useState } from 'react'
import { Button } from '@/components/ui/button'

export default function PollHeader({ poll, did, rkey, isCreator, onEditClick, onDeleteClick }) {
  const [copied, setCopied] = useState(false)

  function copyLink() {
    const url = `${window.location.origin}/p/${did}/${rkey}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const isOpen = !poll.finalTime

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 flex-wrap">
        <h1 className="text-3xl font-semibold tracking-tight text-[#1a1a1a] flex-1 min-w-0">
          {poll.title}
        </h1>
        <span className={`shrink-0 mt-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${
          isOpen
            ? 'bg-[#e8f4e8] text-[#4a7c4a]'
            : 'bg-[#f0eeea] text-[#8a8580]'
        }`}>
          {isOpen ? 'Open' : 'Closed'}
        </span>
      </div>

      {poll.description && (
        <p className="text-[#6b6560] leading-relaxed">{poll.description}</p>
      )}

      <div className="flex items-center gap-3 flex-wrap text-sm text-[#a09a94]">
        {poll.timezone && (
          <span>{poll.timezone}</span>
        )}
        {poll.community && (
          <span className="px-2 py-0.5 rounded-full border border-[#e8e5df] text-xs font-medium text-[#6b6560]">{poll.community}</span>
        )}
        <Button variant="outline" size="sm" onClick={copyLink} className="border-[#e8e5df] text-[#6b6560] hover:bg-[#f0eeea] hover:text-[#1a1a1a]">
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
        {isCreator && isOpen && onEditClick && (
          <Button variant="outline" size="sm" onClick={onEditClick} className="border-[#e8e5df] text-[#6b6560] hover:bg-[#f0eeea] hover:text-[#1a1a1a]">
            Edit poll
          </Button>
        )}
        {isCreator && onDeleteClick && (
          <Button variant="ghost" size="sm" onClick={onDeleteClick} className="text-red-600 hover:bg-red-50 hover:text-red-700">
            Delete
          </Button>
        )}
      </div>
    </div>
  )
}
