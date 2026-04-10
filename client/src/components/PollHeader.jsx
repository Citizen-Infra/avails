import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal } from 'lucide-react'

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
    <div className="space-y-4">
      {/* Title + badges */}
      <div className="flex items-start gap-3">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#1a1a1a] flex-1 min-w-0">
          {poll.title}
        </h1>
        <div className="flex items-center gap-2 shrink-0 mt-1.5">
          {poll.community && (
            <span className="text-sm px-3 py-1.5 rounded-full border border-[#e8e5df] font-medium text-[#6b6560]">{poll.community}</span>
          )}
          <span className={`text-sm px-3 py-1.5 rounded-full font-medium ${
            isOpen
              ? 'bg-[#ccfbf1] text-[#0d9488]'
              : 'bg-[#f0eeea] text-[#8a8580]'
          }`}>
            {isOpen ? 'Open' : 'Scheduled'}
          </span>
        </div>
      </div>

      {/* Description */}
      {poll.description && (
        <p className="text-lg text-[#6b6560] leading-relaxed">{poll.description}</p>
      )}

      {/* Metadata row — informational only */}
      {poll.timezone && (
        <p className="text-sm text-[#a09a94]">
          {Intl.DateTimeFormat().resolvedOptions().timeZone === poll.timezone
            ? poll.timezone
            : `Showing times in ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}
        </p>
      )}

      {/* Actions row — separated, with hierarchy */}
      <div className="flex items-center gap-2 flex-wrap">
        {isCreator && isOpen && onScheduleClick && !schedulingMode && (
          <Button onClick={onScheduleClick} className="bg-[#0d9488] text-white hover:bg-[#0f766e]">
            Schedule meeting
          </Button>
        )}
        <Button variant="outline" onClick={copyLink} className="border-[#d8d4cf] text-[#6b6560] hover:bg-[#f0eeea]">
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
        {isCreator && isOpen && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-[#6b6560] hover:bg-[#f0eeea]">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEditClick && <DropdownMenuItem onClick={onEditClick}>Edit poll</DropdownMenuItem>}
              {onDeleteClick && (
                <DropdownMenuItem onClick={onDeleteClick} className="text-red-600">Delete poll</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
