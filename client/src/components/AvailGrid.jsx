import { useRef, useState, useCallback, useMemo, useEffect } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import '../styles/avail-grid.css'

function generateSlots(dates, timeRange, slotMinutes) {
  const slots = []
  const [startH, startM] = timeRange.start.split(':').map(Number)
  const [endH, endM] = timeRange.end.split(':').map(Number)
  const startTotal = startH * 60 + startM
  const endTotal = endH * 60 + endM

  for (let m = startTotal; m < endTotal; m += slotMinutes) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    slots.push(`${hh}:${mm}`)
  }
  return slots
}

function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })
  const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return { dayName, monthDay }
}

function computeHeatmap(responses, dates, times) {
  const map = {}
  for (const r of responses) {
    const slotSet = new Set(r.slots)
    for (const date of dates) {
      for (const time of times) {
        const key = `${date}T${time}`
        if (slotSet.has(key)) {
          map[key] = (map[key] || 0) + 1
        }
      }
    }
  }
  return map
}

// Heatmap: single green, alpha 20% (1 person) → 90% (everyone)
function slotColor(count, total) {
  if (!count || !total) return null
  const alpha = 0.2 + 0.7 * (count / total)
  return `rgba(34, 197, 94, ${alpha})`
}

const EMPTY_SET = new Set()
const EMPTY_OBJ = {}

export default function AvailGrid({
  dates = [],
  timeRange = { start: '09:00', end: '17:00' },
  slotMinutes = 30,
  responses = [],
  mySlots,
  onSlotsChange,
  readOnly = false,
  focusedName = null,
  busySlots,
  slotEvents,
  scheduledSlots,
  onHoverSlot,
}) {
  // Stable defaults — never pass new Set() / {} inline (React render loop gotcha)
  mySlots = mySlots || EMPTY_SET
  busySlots = busySlots || EMPTY_SET
  slotEvents = slotEvents || EMPTY_OBJ
  scheduledSlots = scheduledSlots || EMPTY_SET

  const containerRef = useRef(null)

  // Date pagination — show max 7 dates at a time with arrows
  const MAX_VISIBLE = 7
  const [page, setPage] = useState(0)
  const totalPages = Math.ceil(dates.length / MAX_VISIBLE)
  const visibleDates = useMemo(
    () => dates.slice(page * MAX_VISIBLE, page * MAX_VISIBLE + MAX_VISIBLE),
    [dates, page]
  )
  const hasLeft = page > 0
  const hasRight = page < totalPages - 1

  // Drag state refs (not state — avoid re-renders on every pointermove)
  const downCell = useRef(null)   // { row, col } | null
  const curCell = useRef(null)    // { row, col } | null
  const downCellWasSelected = useRef(false)
  const tapTarget = useRef(null) // key string for detecting taps in read-only mode

  // Only this triggers re-renders — for CSS class + pending visual
  const [dragState, setDragState] = useState(null) // null | { pending: Set<string>, removing: boolean }
  const [activeSlot, setActiveSlot] = useState(null) // slot key tapped in read-only mode
  const activeSlotRef = useRef(null) // ref mirror to avoid stale closure in commitDrag
  const [focusCell, setFocusCell] = useState({ row: 0, col: 0 }) // roving tabindex for keyboard nav

  // Clear activeSlot when entering edit mode
  useEffect(() => {
    if (!readOnly) {
      activeSlotRef.current = null
      setActiveSlot(null)
      onHoverSlot?.(null)
    }
  }, [readOnly, onHoverSlot])

  const times = useMemo(
    () => generateSlots(dates, timeRange, slotMinutes),
    [dates, timeRange, slotMinutes]
  )

  // When a name is focused, filter responses to just that person's — heatmap
  // becomes a single-person view (cells they picked = full green, everything
  // else empty). Outline-style per-cell highlighting is gone in favor of this.
  const effectiveResponses = useMemo(() => {
    if (!focusedName) return responses
    const r = responses.find((r) => r.name === focusedName)
    return r ? [r] : []
  }, [responses, focusedName])

  const heatmap = useMemo(
    () => computeHeatmap(effectiveResponses, dates, times),
    [effectiveResponses, dates, times]
  )

  const totalRespondents = effectiveResponses.length

  // Precompute scheduled card positions: for each column, find first scheduled row and span
  const scheduledCards = useMemo(() => {
    if (!scheduledSlots || scheduledSlots.size === 0) return {}
    const cards = {} // key: `${colIdx}` → { startRow, span, startTime, endTime }
    for (let colIdx = 0; colIdx < visibleDates.length; colIdx++) {
      const date = visibleDates[colIdx]
      let startRow = -1
      let span = 0
      for (let rowIdx = 0; rowIdx < times.length; rowIdx++) {
        const key = `${date}T${times[rowIdx]}`
        if (scheduledSlots.has(key)) {
          if (startRow === -1) startRow = rowIdx
          span++
        } else if (startRow !== -1) {
          break // end of contiguous block
        }
      }
      if (startRow !== -1) {
        const endMinutes = times[startRow + span - 1]
        // End time = last slot start + slotMinutes
        const [eh, em] = endMinutes.split(':').map(Number)
        const endTotal = eh * 60 + em + slotMinutes
        const endTime = `${String(Math.floor(endTotal / 60)).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`
        cards[colIdx] = { startRow, span, startTime: times[startRow], endTime }
      }
    }
    return cards
  }, [scheduledSlots, visibleDates, times, slotMinutes])

  // Compute pending keys from rectangle between downCell and curCell
  const computePendingKeys = useCallback(
    (down, cur) => {
      const minRow = Math.min(down.row, cur.row)
      const maxRow = Math.max(down.row, cur.row)
      const minCol = Math.min(down.col, cur.col)
      const maxCol = Math.max(down.col, cur.col)
      const keys = new Set()
      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          if (r < times.length && c < visibleDates.length) {
            keys.add(`${visibleDates[c]}T${times[r]}`)
          }
        }
      }
      return keys
    },
    [visibleDates, times]
  )

  const handlePointerDown = useCallback(
    (e, row, col) => {
      setFocusCell({ row, col }) // keep keyboard focus in sync with pointer
      const key = `${visibleDates[col]}T${times[row]}`
      if (readOnly) {
        e.preventDefault()
        tapTarget.current = key
        return
      }
      e.preventDefault()
      const wasSelected = mySlots.has(key)
      downCell.current = { row, col }
      curCell.current = { row, col }
      downCellWasSelected.current = wasSelected
      const pending = new Set([key])
      setDragState({ pending, removing: wasSelected })
    },
    [readOnly, mySlots, visibleDates, times]
  )

  const handlePointerEnter = useCallback(
    (e, row, col) => {
      if (downCell.current) {
        if (readOnly) return
        curCell.current = { row, col }
        const pending = computePendingKeys(downCell.current, { row, col })
        setDragState({ pending, removing: downCellWasSelected.current })
      } else {
        const key = `${visibleDates[col]}T${times[row]}`
        onHoverSlot?.(key)
      }
    },
    [readOnly, computePendingKeys, visibleDates, times, onHoverSlot]
  )

  const handlePointerMove = useCallback(
    (e) => {
      if (!downCell.current) return
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el) return
      const cell = el.closest('[data-row]')
      if (!cell) return
      const row = parseInt(cell.dataset.row, 10)
      const col = parseInt(cell.dataset.col, 10)
      if (isNaN(row) || isNaN(col)) return
      if (curCell.current && curCell.current.row === row && curCell.current.col === col) return
      curCell.current = { row, col }
      const pending = computePendingKeys(downCell.current, { row, col })
      setDragState({ pending, removing: downCellWasSelected.current })
    },
    [computePendingKeys]
  )

  // Commit on pointerup — attached to document so it fires even outside the grid
  const commitDrag = useCallback(() => {
    // Handle read-only tap
    if (tapTarget.current) {
      const key = tapTarget.current
      tapTarget.current = null
      const newActive = activeSlotRef.current === key ? null : key
      activeSlotRef.current = newActive
      setActiveSlot(newActive)
      onHoverSlot?.(newActive)
      return
    }

    if (!downCell.current) return
    const pending = computePendingKeys(downCell.current, curCell.current)
    const next = new Set(mySlots)
    if (downCellWasSelected.current) {
      // Remove mode
      for (const k of pending) next.delete(k)
    } else {
      // Add mode
      for (const k of pending) next.add(k)
    }
    onSlotsChange?.(next)
    downCell.current = null
    curCell.current = null
    setDragState(null)
  }, [mySlots, onSlotsChange, computePendingKeys, onHoverSlot])

  // Document-level pointerup + pointermove listeners
  useEffect(() => {
    document.addEventListener('pointerup', commitDrag)
    document.addEventListener('pointermove', handlePointerMove)
    return () => {
      document.removeEventListener('pointerup', commitDrag)
      document.removeEventListener('pointermove', handlePointerMove)
    }
  }, [commitDrag, handlePointerMove])

  function getTooltipContent(date, time) {
    const key = `${date}T${time}`
    const count = heatmap[key] || 0
    if (count === 0) return null
    const names = effectiveResponses
      .filter((r) => r.slots.includes(key))
      .map((r) => r.name)
    if (focusedName) return `${focusedName} available`
    return `${count}/${totalRespondents} available — ${names.join(', ')}`
  }

  // Keyboard navigation (WCAG 2.1.1) — roving tabindex over cells with arrow
  // keys to move and Space/Enter to toggle. Clamp focus to current page bounds.
  const fRow = Math.min(focusCell.row, Math.max(0, times.length - 1))
  const fCol = Math.min(focusCell.col, Math.max(0, visibleDates.length - 1))

  function focusCellAt(row, col) {
    containerRef.current
      ?.querySelector(`[data-row="${row}"][data-col="${col}"]`)
      ?.focus()
  }

  function handleGridKeyDown(e) {
    const maxRow = times.length - 1
    const maxCol = visibleDates.length - 1
    let r = fRow
    let c = fCol
    if (e.key === 'ArrowUp') r = Math.max(0, fRow - 1)
    else if (e.key === 'ArrowDown') r = Math.min(maxRow, fRow + 1)
    else if (e.key === 'ArrowLeft') c = Math.max(0, fCol - 1)
    else if (e.key === 'ArrowRight') c = Math.min(maxCol, fCol + 1)
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const key = `${visibleDates[fCol]}T${times[fRow]}`
      if (readOnly) {
        const newActive = activeSlotRef.current === key ? null : key
        activeSlotRef.current = newActive
        setActiveSlot(newActive)
        onHoverSlot?.(newActive)
      } else {
        const next = new Set(mySlots)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        onSlotsChange?.(next)
      }
      return
    } else {
      return
    }
    e.preventDefault()
    setFocusCell({ row: r, col: c })
    requestAnimationFrame(() => focusCellAt(r, c))
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-2">
        {/* Pagination arrows + month header */}
        {dates.length > MAX_VISIBLE && (
          <div className="flex items-center justify-between px-1">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={!hasLeft}
              className={cn('p-1.5 rounded-lg transition-colors', hasLeft ? 'text-[#1a1a1a] hover:bg-[#f0eeea]' : 'text-[#d8d4cf] cursor-default')}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4l-6 6 6 6"/></svg>
            </button>
            <span className="text-sm font-medium text-[#6b6560]">
              {formatDate(visibleDates[0]).monthDay} — {formatDate(visibleDates[visibleDates.length - 1]).monthDay}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!hasRight}
              className={cn('p-1.5 rounded-lg transition-colors', hasRight ? 'text-[#1a1a1a] hover:bg-[#f0eeea]' : 'text-[#d8d4cf] cursor-default')}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 4l6 6-6 6"/></svg>
            </button>
          </div>
        )}

        <div
          ref={containerRef}
          className={cn('select-none relative overflow-x-auto', dragState && 'avail-grid--dragging', mySlots.size > 0 && 'avail-grid--has-selection')}
          style={{ touchAction: 'none' }}
          onPointerLeave={() => { if (!downCell.current && !activeSlotRef.current) onHoverSlot?.(null) }}
        >
          <div
            role="group"
            aria-label="Availability grid. Use arrow keys to move between time slots and Space to toggle your availability."
            onKeyDown={handleGridKeyDown}
            className="grid w-full rounded-lg border border-[#d8d4cf] overflow-hidden"
            style={{
              gridTemplateColumns: `clamp(3rem, 12vw, 5rem) repeat(${visibleDates.length}, 1fr)`,
            }}
          >
            {/* Header row */}
            <div /> {/* empty corner */}
            {visibleDates.map((date) => {
            const { dayName, monthDay } = formatDate(date)
            return (
              <div
                key={date}
                className="flex flex-col items-center gap-0.5 pb-2 pt-1 text-center"
              >
                <span className="text-[11px] font-medium text-[#8a8580] uppercase tracking-[0.1em]">
                  {dayName}
                </span>
                <span className="text-base text-[#1a1a1a] font-semibold tabular-nums leading-none">{monthDay}</span>
              </div>
            )
          })}

          {/* Time rows */}
          {times.map((time, rowIdx) => (
            <>
              {/* Time label */}
              <div
                key={`label-${time}`}
                className="pr-2 flex items-start justify-end -mt-[7px]"
              >
                <span className={cn(
                  'text-xs tabular-nums leading-none',
                  time.endsWith(':00')
                    ? 'text-[#1a1a1a] font-medium'
                    : 'text-[#a09a94]'
                )}>
                  {time}
                </span>
              </div>

              {/* Slot cells for each date */}
              {visibleDates.map((date, colIdx) => {
                const key = `${date}T${time}`
                // When a name is focused, the grid is a view of their availability —
                // drop the teal "mine" overlay so we don't mix two lenses at once.
                const isMine = mySlots.has(key) && !focusedName
                const isBusy = busySlots.has(key)
                const isScheduled = scheduledSlots.has(key)
                const heatCount = heatmap[key] || 0
                const bgColor = heatCount > 0 ? slotColor(heatCount, totalRespondents) : undefined
                const tooltipText = getTooltipContent(date, time)

                const isPendingAdd = dragState && !dragState.removing && dragState.pending.has(key)
                const isPendingRemove = dragState && dragState.removing && dragState.pending.has(key)

                // Only show event name on the first slot of a contiguous event
                const eventName = isBusy ? slotEvents[key] : null
                const prevKey = rowIdx > 0 ? `${date}T${times[rowIdx - 1]}` : null
                const prevEventName = prevKey ? slotEvents[prevKey] : null
                const showEventName = eventName && eventName !== prevEventName

                const fd = formatDate(date)
                const cellLabel =
                  `${fd.dayName} ${fd.monthDay} at ${time}` +
                  (totalRespondents > 0 ? `, ${heatCount} of ${totalRespondents} available` : ', no responses yet') +
                  (isBusy ? ', busy on your calendar' : '') +
                  (isScheduled ? ', scheduled time' : '') +
                  (!readOnly ? (isMine ? ', selected' : ', not selected') : '')

                const cell = (
                  <div
                    key={key}
                    data-row={rowIdx}
                    data-col={colIdx}
                    role="button"
                    aria-label={cellLabel}
                    aria-pressed={readOnly ? undefined : isMine}
                    tabIndex={rowIdx === fRow && colIdx === fCol ? 0 : -1}
                    className={cn(
                      'avail-cell h-8 cursor-pointer',
                      time.endsWith(':00') && rowIdx > 0 && slotMinutes < 60 && 'avail-cell--hour',
                      !(isScheduled && scheduledCards[colIdx]?.startRow === rowIdx) && 'overflow-hidden',
                      rowIdx === 0 && 'rounded-t',
                      rowIdx === times.length - 1 && 'rounded-b',
                      readOnly && 'avail-cell--readonly cursor-default',
                      activeSlot === key && 'avail-cell--active',
                      isScheduled && 'avail-cell--scheduled',
                      // Drag preview — highest priority
                      isPendingAdd && 'avail-cell--pending-add',
                      isPendingRemove && 'avail-cell--pending-remove',
                      // Three-layer composition:
                      //  - bgColor (inline style)    = heatmap base, always paints when count>0
                      //  - .avail-cell--mine          = translucent teal wash on top + left stripe
                      //  - .avail-cell--busy          = translucent rose wash on top
                      //  - .avail-cell--empty         = warm neutral tint when no heatmap
                      !isPendingAdd && !isPendingRemove && cn(
                        isMine && 'avail-cell--mine',
                        isBusy && 'avail-cell--busy',
                        !bgColor && 'avail-cell--empty',
                      ),
                    )}
                    style={{
                      backgroundColor: isPendingAdd || isPendingRemove ? undefined : bgColor,
                    }}
                    onPointerDown={(e) => handlePointerDown(e, rowIdx, colIdx)}
                    onPointerEnter={(e) => handlePointerEnter(e, rowIdx, colIdx)}
                  >
                    {showEventName && (
                      <span className="absolute left-1 right-1 top-0.5 bottom-0.5 flex items-start rounded bg-rose-400/90 px-1.5 py-0.5 text-[11px] leading-tight text-white font-medium truncate pointer-events-none z-[1] shadow-sm">
                        {eventName}
                      </span>
                    )}
                    {/* Scheduled time overlay card — rendered on first scheduled cell */}
                    {isScheduled && scheduledCards[colIdx]?.startRow === rowIdx && (
                      <div
                        className="avail-scheduled-card"
                        style={{ height: `calc(${scheduledCards[colIdx].span} * 2rem - 2px)` }}
                      >
                        <span className="avail-scheduled-card__check">
                          <svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          Scheduled
                        </span>
                        <span className="avail-scheduled-card__time">
                          {scheduledCards[colIdx].startTime} – {scheduledCards[colIdx].endTime}
                        </span>
                      </div>
                    )}
                  </div>
                )

                if (!tooltipText) return cell

                return (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>{cell}</TooltipTrigger>
                    <TooltipContent side="top">
                      <span>{tooltipText}</span>
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </>
          ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
