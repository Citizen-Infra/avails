import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal } from 'lucide-react'
import { descriptionLinks } from '@/lib/descriptionLinks'

export default function PollHeader({ poll, did, rkey, isCreator, onEditClick, onDeleteClick, onScheduleClick, onUnscheduleClick, schedulingMode, submitted, responseRkey, onEditResponse, onDeleteResponse, showCalendarConnect, onConnectGoogleCalendar, connectingCalendar }) {
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
      <div className="flex flex-wrap items-start gap-3">
        <h1 className="font-bold tracking-tight text-foreground flex-1 min-w-[min(100%,18rem)]">
          {poll.title}
        </h1>
        <div className="flex items-center gap-2 shrink-0 mt-1.5">
          {poll.community && (
            <span className="text-sm px-3 py-1.5 rounded-sm border border-border font-medium text-foreground-secondary">{poll.community}</span>
          )}
          <span className={`text-sm px-3 py-1.5 rounded-full font-medium ${
            isOpen
              ? 'bg-accent text-primary'
              : 'bg-muted text-muted-foreground'
          }`}>
            {isOpen ? 'Open' : 'Scheduled'}
          </span>
        </div>
      </div>

      {/* Description */}
      {poll.description && (
        <p className="text-lg text-foreground-secondary leading-relaxed break-words">
          {descriptionLinks(poll.description).map((part, index) => part.href
            ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" className="text-primary-hover underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{part.text}</a>
            : part.text)}
        </p>
      )}

      {/* Metadata row — informational only */}
      {poll.timezone && (
        <p className="text-sm text-muted-foreground">
          {Intl.DateTimeFormat().resolvedOptions().timeZone === poll.timezone
            ? poll.timezone
            : `Showing times in ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}
        </p>
      )}

      {/* Actions row */}
      <div className="flex items-center gap-2 flex-wrap">
        {isCreator && isOpen && onScheduleClick && !schedulingMode && (
          <Button onClick={onScheduleClick} className="bg-primary text-primary-foreground hover:bg-primary-hover">
            Schedule meeting
          </Button>
        )}
        <Button variant="outline" onClick={copyLink} className="border-input text-foreground-secondary hover:bg-muted">
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
        {showCalendarConnect && (
          <Button
            variant="outline"
            onClick={onConnectGoogleCalendar}
            disabled={connectingCalendar}
            className="border-input text-foreground-secondary hover:bg-muted gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
              <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {connectingCalendar ? 'Connecting…' : 'Google Calendar'}
          </Button>
        )}
        {isCreator && (isOpen || onUnscheduleClick) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Poll actions" className="text-foreground-secondary hover:bg-muted">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isOpen && onEditClick && <DropdownMenuItem onClick={onEditClick}>Edit poll</DropdownMenuItem>}
              {!isOpen && onUnscheduleClick && (
                <DropdownMenuItem onClick={onUnscheduleClick}>Unschedule meeting</DropdownMenuItem>
              )}
              {onDeleteClick && (
                <DropdownMenuItem onClick={onDeleteClick} className="text-destructive">Delete poll</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Response status — inline after poll actions */}
        {submitted && (
          <>
            <span className="text-input select-none" aria-hidden="true">·</span>
            <span className="text-sm text-primary font-medium flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Saved
            </span>
            {isOpen && responseRkey && (
              <>
                <span className="text-input select-none" aria-hidden="true">·</span>
                <button onClick={onEditResponse} className="text-sm text-foreground-secondary hover:text-foreground transition-colors">
                  Edit
                </button>
                <button onClick={onDeleteResponse} className="text-sm text-foreground-secondary hover:text-destructive transition-colors">
                  Delete
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
