import { useState } from 'react'
import { cn } from '@/lib/utils'

export default function ResponsePanel({ responses = [], highlightName, onHighlight, hoverSlot = null, hiddenUntilSubmit = false }) {
  const [sticky, setSticky] = useState(null)

  function handleMouseEnter(name) {
    if (!sticky) onHighlight(name)
  }

  function handleMouseLeave() {
    if (!sticky) onHighlight(null)
  }

  function handleClick(name) {
    if (sticky === name) {
      setSticky(null)
      onHighlight(null)
    } else {
      setSticky(name)
      onHighlight(name)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="w-8 h-1 bg-[#0d9488] rounded-full mb-2" />
        <div className="text-sm font-semibold text-[#1a1a1a] uppercase tracking-wide">
          {hiddenUntilSubmit ? 'Responses hidden' : `${responses.length} ${responses.length === 1 ? 'response' : 'responses'}`}
        </div>
        {responses.length > 0 && !hiddenUntilSubmit && (
          <p className="text-xs text-[#a09a94] mt-1">Tap a name to see their availability</p>
        )}
      </div>
      <ul className="space-y-0.5">
        {responses.map((r) => {
          const isActive = highlightName === r.name
          const isAvailableAtHover = hoverSlot !== null && r.slots.includes(hoverSlot)
          const isUnavailableAtHover = hoverSlot !== null && !r.slots.includes(hoverSlot)
          return (
            <li key={r.name}>
              <button
                type="button"
                className={cn(
                  'w-full text-left px-3 py-2.5 rounded-md text-base transition-all duration-150',
                  'cursor-pointer hover:bg-[#f0eeea]',
                  isActive ? 'text-[#1a1a1a] bg-[#f0eeea] ring-1 ring-[#0d9488]/30' : 'text-[#6b6560]',
                  isAvailableAtHover && 'bg-[#f0fdf4]',
                  isUnavailableAtHover && 'opacity-40'
                )}
                onMouseEnter={() => handleMouseEnter(r.name)}
                onMouseLeave={handleMouseLeave}
                onClick={() => handleClick(r.name)}
              >
                <span className="flex items-center gap-1.5">
                  {isAvailableAtHover && (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#0d9488] shrink-0">
                      <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  <span className={cn('font-medium', isUnavailableAtHover ? 'text-[#a09a94]' : 'text-[#1a1a1a]')}>
                    {r.name}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
        {responses.length === 0 && (
          <li className="text-base text-[#a09a94] px-3 py-2">
            {hiddenUntilSubmit
              ? 'Responses are hidden until you save your own availability.'
              : 'No responses yet.'}
          </li>
        )}
      </ul>
    </div>
  )
}
