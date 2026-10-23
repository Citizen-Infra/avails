import { useState } from 'react'
import { cn } from '@/lib/utils'

export default function ResponsePanel({ responses = [], focusedName, onFocus, hoverSlot = null, hiddenUntilSubmit = false }) {
  const [pinned, setPinned] = useState(null)

  function handleMouseEnter(name) {
    if (!pinned) onFocus(name)
  }

  function handleMouseLeave() {
    if (!pinned) onFocus(null)
  }

  function handleClick(name) {
    if (pinned === name) {
      setPinned(null)
      onFocus(null)
    } else {
      setPinned(name)
      onFocus(name)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="w-full border-t border-input mb-2" />
        <div className="text-sm font-semibold text-foreground">
          {hiddenUntilSubmit ? 'Responses hidden' : `${responses.length} ${responses.length === 1 ? 'response' : 'responses'}`}
        </div>
        {responses.length > 0 && !hiddenUntilSubmit && (
          <p className="text-sm text-muted-foreground mt-1">Hover or tap a name to see only their availability</p>
        )}
      </div>
      <ul className="space-y-0.5">
        {responses.map((r) => {
          const isFocused = focusedName === r.name
          const isPinned = pinned === r.name
          const isAvailableAtHover = hoverSlot !== null && r.slots.includes(hoverSlot)
          const isUnavailableAtHover = hoverSlot !== null && !r.slots.includes(hoverSlot)
          return (
            <li key={r.name}>
              <button
                type="button"
                className={cn(
                  'w-full text-left px-3 py-2.5 rounded-md text-base transition-all duration-150',
                  'cursor-pointer hover:bg-muted',
                  isFocused ? 'text-foreground bg-muted' : 'text-foreground-secondary',
                  isPinned && 'ring-1 ring-ring',
                  isAvailableAtHover && 'bg-success-muted',
                  isUnavailableAtHover && 'opacity-90'
                )}
                onMouseEnter={() => handleMouseEnter(r.name)}
                onMouseLeave={handleMouseLeave}
                onClick={() => handleClick(r.name)}
              >
                <span className="flex items-center gap-1.5">
                  {isAvailableAtHover && (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-primary shrink-0">
                      <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  <span className={cn('font-medium', isUnavailableAtHover ? 'text-muted-foreground' : 'text-foreground')}>
                    {r.name}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
        {responses.length === 0 && (
          <li className="text-base text-muted-foreground px-3 py-2">
            {hiddenUntilSubmit
              ? 'Responses are hidden until you save your own availability.'
              : 'No responses yet.'}
          </li>
        )}
      </ul>
    </div>
  )
}
