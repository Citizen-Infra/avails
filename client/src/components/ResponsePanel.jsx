import { useState } from 'react'
import { cn } from '@/lib/utils'

export default function ResponsePanel({ responses = [], highlightName, onHighlight, hoverSlot = null }) {
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
    <div className="space-y-3">
      <div className="text-xs font-medium text-[#a09a94] uppercase tracking-wide">
        {responses.length} {responses.length === 1 ? 'response' : 'responses'}
      </div>
      <ul className="space-y-0.5">
        {responses.map((r) => {
          const isActive = highlightName === r.name
          const isUnavailableAtHover = hoverSlot !== null && !r.slots.includes(hoverSlot)
          return (
            <li key={r.name}>
              <button
                type="button"
                className={cn(
                  'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                  'hover:bg-[#f0eeea]',
                  isActive ? 'bg-[#f0eeea] text-[#1a1a1a]' : 'text-[#6b6560]',
                  isUnavailableAtHover && 'opacity-40'
                )}
                onMouseEnter={() => handleMouseEnter(r.name)}
                onMouseLeave={handleMouseLeave}
                onClick={() => handleClick(r.name)}
              >
                <span className="font-medium text-[#1a1a1a]">{r.name}</span>
                <span className="ml-2 text-[#a09a94] text-xs">
                  {r.slots.length} {r.slots.length === 1 ? 'slot' : 'slots'}
                </span>
              </button>
            </li>
          )
        })}
        {responses.length === 0 && (
          <li className="text-sm text-[#a09a94] px-3 py-2">
            No responses yet.
          </li>
        )}
      </ul>
    </div>
  )
}
