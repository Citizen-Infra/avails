import { useState } from 'react'
import { Button } from '@/components/ui/button'

export default function PollHeader({ poll, did, rkey, isCreator, onEditClick, onDeleteClick, onScheduleClick, schedulingMode }) {
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
        <h1 className="text-4xl font-bold tracking-tight text-[#1a1a1a] flex-1 min-w-0">
          {poll.title}
        </h1>
        <span className={`shrink-0 mt-2 text-sm px-3 py-1.5 rounded-full font-medium ${
          isOpen
            ? 'bg-[#ccfbf1] text-[#0d9488]'
            : 'bg-[#f0eeea] text-[#8a8580]'
        }`}>
          {isOpen ? 'Open' : 'Closed'}
        </span>
      </div>

      {poll.description && (
        <p className="text-lg text-[#6b6560] leading-relaxed">{poll.description}</p>
      )}

      <div className="flex items-center gap-3 flex-wrap text-base text-[#a09a94]">
        {poll.timezone && (
          <span>{poll.timezone}</span>
        )}
        {poll.community && (
          <span className="px-3 py-1 rounded-full border border-[#e8e5df] text-sm font-medium text-[#6b6560]">{poll.community}</span>
        )}
        <Button variant="outline" onClick={copyLink} className="border-[#0d9488] text-[#0d9488] hover:bg-[#ccfbf1] text-base px-5 py-2 rounded-lg">
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
        {isCreator && isOpen && onScheduleClick && !schedulingMode && (
          <Button onClick={onScheduleClick} className="bg-[#0d9488] text-white hover:bg-[#0f766e] text-base px-5 py-2 rounded-lg">
            Schedule meeting
          </Button>
        )}
        {isCreator && isOpen && onEditClick && (
          <Button variant="outline" onClick={onEditClick} className="border-[#0d9488] text-[#0d9488] hover:bg-[#ccfbf1] text-base px-5 py-2 rounded-lg">
            Edit poll
          </Button>
        )}
        {isCreator && onDeleteClick && (
          <Button variant="ghost" onClick={onDeleteClick} className="text-red-600 hover:bg-red-50 hover:text-red-700 text-base">
            Delete
          </Button>
        )}
      </div>
    </div>
  )
}
