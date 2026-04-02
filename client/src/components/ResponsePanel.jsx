import { useState } from 'react'
import { cn } from '@/lib/utils'

export default function ResponsePanel({ responses = [], highlightName, onHighlight }) {
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
      <div className="text-sm font-medium">
        {responses.length} {responses.length === 1 ? 'response' : 'responses'}
      </div>
      <ul className="space-y-1">
        {responses.map((r) => {
          const isActive = highlightName === r.name
          return (
            <li key={r.name}>
              <button
                type="button"
                className={cn(
                  'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                  'hover:bg-muted',
                  isActive && 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
                )}
                onMouseEnter={() => handleMouseEnter(r.name)}
                onMouseLeave={handleMouseLeave}
                onClick={() => handleClick(r.name)}
              >
                <span className="font-medium">{r.name}</span>
                <span className="ml-2 text-muted-foreground text-xs">
                  {r.slots.length} {r.slots.length === 1 ? 'slot' : 'slots'}
                </span>
              </button>
            </li>
          )
        })}
        {responses.length === 0 && (
          <li className="text-sm text-muted-foreground px-3 py-2">
            No responses yet.
          </li>
        )}
      </ul>
    </div>
  )
}
