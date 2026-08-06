import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { cn } from '@/lib/utils'
import MeetingLinkField from './MeetingLinkField'
import '../styles/avail-grid.css'

/**
 * SchedulingGrid — a separate grid overlay for the creator to pick a time block.
 * Uses its own drag state, completely independent from AvailGrid's response mode.
 * Renders on top of the heatmap data so the creator can see availability while selecting.
 */

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
  return {
    dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
    monthDay: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }
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

// Match AvailGrid's heatmap exactly so the green doesn't shift when the creator
// switches from response view to scheduling view (Consensus Green, alpha 0.2 → 0.9).
function slotColor(count, total) {
  if (!count || !total) return null
  const alpha = 0.2 + 0.7 * (count / total)
  return `rgba(34, 197, 94, ${alpha})`
}

export default function SchedulingGrid({
  dates,
  timeRange,
  slotMinutes,
  responses,
  onSelect, // (slots: string[]) => void — called on pointerup with sorted slot keys
  onCancel,
  onConfirm,
  confirmDisabled,
  confirmLoading,
  error,
  // New: calendar picker
  googleConnected,            // boolean — has the creator OAuth'd Google?
  writableCalendars,          // array of { id, summary, primary } | null
  chosenCalendarId,           // string | 'none'
  onChooseCalendar,           // (id: string | 'none') => void
  onConnectGoogle,            // () => void — opens OAuth with events scope
  // Meeting link (#19). Set here so the FIRST invite already carries it; the
  // result card handles adding one later. Omit onMeetingUrlChange to hide the
  // field entirely.
  meetingUrl = '',            // string — controlled by the parent
  onMeetingUrlChange,         // ((v: string) => void) | undefined
  jitsiSuggestion,            // string — the room offered, never pre-filled
}) {
  const times = useMemo(
    () => generateSlots(dates, timeRange, slotMinutes),
    [dates, timeRange, slotMinutes]
  )
  const heatmap = useMemo(
    () => computeHeatmap(responses, dates, times),
    [responses, dates, times]
  )
  const totalRespondents = responses.length

  // Drag state — all refs except selectedSlots which needs to trigger render
  const downCell = useRef(null)
  const curCell = useRef(null)
  const [dragPending, setDragPending] = useState(null) // Set<string> | null
  const [selectedSlots, setSelectedSlots] = useState(new Set())
  const [focusCell, setFocusCell] = useState({ row: 0, col: 0 }) // roving tabindex
  const kbAnchor = useRef(null) // keyboard block-selection anchor
  const gridRef = useRef(null)

  // Date pagination — mirror AvailGrid: show max 7 dates at a time with arrows.
  // Without this the grid renders every day in one row and overflows the viewport
  // on mobile (issue #82). Selection persists across pages because slot keys are
  // absolute (date+time), not page-relative.
  const MAX_VISIBLE = 7
  const [page, setPage] = useState(0)
  const totalPages = Math.ceil(dates.length / MAX_VISIBLE)
  const visibleDates = useMemo(
    () => dates.slice(page * MAX_VISIBLE, page * MAX_VISIBLE + MAX_VISIBLE),
    [dates, page]
  )
  const hasLeft = page > 0
  const hasRight = page < totalPages - 1

  const computePendingKeys = useCallback((down, cur) => {
    // Constrain to same column (single day)
    const col = down.col
    const minRow = Math.min(down.row, cur.row)
    const maxRow = Math.max(down.row, cur.row)
    const keys = new Set()
    for (let r = minRow; r <= maxRow; r++) {
      if (r < times.length && col < visibleDates.length) {
        keys.add(`${visibleDates[col]}T${times[r]}`)
      }
    }
    return keys
  }, [visibleDates, times])

  const handlePointerDown = useCallback((e, row, col) => {
    e.preventDefault()
    setFocusCell({ row, col }) // keep keyboard focus in sync with pointer
    downCell.current = { row, col }
    curCell.current = { row, col }
    const key = `${visibleDates[col]}T${times[row]}`
    setDragPending(new Set([key]))
  }, [visibleDates, times])

  const handlePointerEnter = useCallback((e, row, col) => {
    if (!downCell.current) return
    // Constrain to same column
    curCell.current = { row, col: downCell.current.col }
    const pending = computePendingKeys(downCell.current, curCell.current)
    setDragPending(pending)
  }, [computePendingKeys])

  const commitDrag = useCallback(() => {
    if (!downCell.current) return
    const pending = computePendingKeys(downCell.current, curCell.current)
    setSelectedSlots(pending)
    const sorted = Array.from(pending).sort()
    onSelect(sorted)
    downCell.current = null
    curCell.current = null
    setDragPending(null)
  }, [computePendingKeys, onSelect])

  useEffect(() => {
    document.addEventListener('pointerup', commitDrag)
    return () => document.removeEventListener('pointerup', commitDrag)
  }, [commitDrag])

  // Keyboard navigation (WCAG 2.1.1). Arrows move; Space/Enter anchors a single
  // cell; Shift+Up/Down extends the time block within the anchor's column.
  const fRow = Math.min(focusCell.row, Math.max(0, times.length - 1))
  const fCol = Math.min(focusCell.col, Math.max(0, visibleDates.length - 1))

  function focusCellAt(row, col) {
    gridRef.current
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
      kbAnchor.current = { row: fRow, col: fCol }
      setSelectedSlots(new Set([key]))
      onSelect([key])
      return
    } else {
      return
    }
    e.preventDefault()
    // Shift + vertical extends the contiguous block from the anchor (same column)
    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (!kbAnchor.current || kbAnchor.current.col !== fCol) {
        kbAnchor.current = { row: fRow, col: fCol }
      }
      const col = kbAnchor.current.col
      const lo = Math.min(kbAnchor.current.row, r)
      const hi = Math.max(kbAnchor.current.row, r)
      const sel = new Set()
      for (let i = lo; i <= hi; i++) sel.add(`${visibleDates[col]}T${times[i]}`)
      setSelectedSlots(sel)
      onSelect(Array.from(sel).sort())
    }
    setFocusCell({ row: r, col: c })
    requestAnimationFrame(() => focusCellAt(r, c))
  }

  return (
    <div className="space-y-4">
      {/* Scheduling bar */}
      <div className="rounded-lg bg-[#0d9488] text-white px-6 py-4 space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <p className="text-base font-medium">Select a time block on the grid</p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Add-to-calendar picker */}
          {googleConnected && writableCalendars && writableCalendars.length > 0 ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-white/90">Add to:</span>
              <select
                value={chosenCalendarId}
                onChange={(e) => onChooseCalendar(e.target.value)}
                className="rounded-md bg-white text-[#1a1a1a] px-2 py-1.5 text-sm border-0 focus:ring-2 focus:ring-white"
              >
                <option value="none">Don't add</option>
                {writableCalendars.map((c) => (
                  <option key={c.id} value={c.id}>{c.summary}{c.primary ? ' (primary)' : ''}</option>
                ))}
              </select>
            </label>
          ) : (
            <button
              type="button"
              onClick={onConnectGoogle}
              className="text-sm underline underline-offset-2 hover:text-white/80"
            >
              Connect Google Calendar to add event
            </button>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className="text-base px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={confirmDisabled}
              className="text-base px-4 py-2 rounded-lg bg-white text-[#0d9488] font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
            >
              {confirmLoading ? 'Scheduling...' : 'Schedule'}
            </button>
          </div>
        </div>
      </div>

      {/* Below the teal bar rather than inside it, for two reasons: the bar is
          already a dense control strip that would crowd at the sm breakpoint,
          and white body text on Gather Teal measures 3.75:1 — fine for the
          bar's large text and buttons, under AA for a field label and an error
          message. On Paper Cream those clear it comfortably. */}
      {onMeetingUrlChange && (
        <div className="max-w-md">
          <MeetingLinkField
            value={meetingUrl}
            onChange={onMeetingUrlChange}
            suggestion={jitsiSuggestion}
            disabled={confirmLoading}
          />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Pagination arrows + month-range header — mirrors AvailGrid */}
      {dates.length > MAX_VISIBLE && (
        <div className="flex items-center justify-between px-1">
          <button
            onClick={() => setPage((p) => p - 1)}
            disabled={!hasLeft}
            className={cn('p-1.5 rounded-lg transition-colors', hasLeft ? 'text-[#1a1a1a] hover:bg-[#f0eeea]' : 'text-[#d8d4cf] cursor-default')}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4l-6 6 6 6" /></svg>
          </button>
          <span className="text-sm font-medium text-[#6b6560]">
            {formatDate(visibleDates[0]).monthDay} — {formatDate(visibleDates[visibleDates.length - 1]).monthDay}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasRight}
            className={cn('p-1.5 rounded-lg transition-colors', hasRight ? 'text-[#1a1a1a] hover:bg-[#f0eeea]' : 'text-[#d8d4cf] cursor-default')}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 4l6 6-6 6" /></svg>
          </button>
        </div>
      )}

      {/* Grid */}
      <div
        className="select-none overflow-x-auto"
        style={{ touchAction: 'none', cursor: 'crosshair' }}
      >
        <div
          ref={gridRef}
          role="group"
          aria-label="Time-block picker. Use arrow keys to move, Space to start a block, Shift with up or down to extend it."
          onKeyDown={handleGridKeyDown}
          className="grid w-full rounded-lg border border-[#d8d4cf] overflow-hidden"
          style={{
            gridTemplateColumns: `clamp(3rem, 12vw, 5rem) repeat(${visibleDates.length}, 1fr)`,
          }}
        >
          {/* Header */}
          <div />
          {visibleDates.map((date) => {
            const { dayName, monthDay } = formatDate(date)
            return (
              <div key={date} className="flex flex-col items-center gap-0.5 pb-2 pt-1 text-center">
                <span className="text-[11px] font-medium text-[#8a8580] uppercase tracking-[0.1em]">{dayName}</span>
                <span className="text-base text-[#1a1a1a] font-semibold tabular-nums leading-none">{monthDay}</span>
              </div>
            )
          })}

          {/* Rows */}
          {times.map((time, rowIdx) => (
            <>
              <div key={`label-${time}`} className="pr-2 flex items-start justify-end -mt-[7px]">
                <span className={cn(
                  'text-xs tabular-nums leading-none',
                  time.endsWith(':00') ? 'text-[#1a1a1a] font-medium' : 'text-[#a09a94]'
                )}>
                  {time}
                </span>
              </div>
              {visibleDates.map((date, colIdx) => {
                const key = `${date}T${time}`
                const heatCount = heatmap[key] || 0
                const bgColor = heatCount > 0 ? slotColor(heatCount, totalRespondents) : undefined
                const isPending = dragPending && dragPending.has(key)
                const isSelected = selectedSlots.has(key)
                const fd = formatDate(date)
                const cellLabel =
                  `${fd.dayName} ${fd.monthDay} at ${time}` +
                  (heatCount > 0 ? `, ${heatCount} of ${totalRespondents} available` : '') +
                  (isSelected ? ', selected for the meeting' : '')

                return (
                  <div
                    key={key}
                    data-row={rowIdx}
                    data-col={colIdx}
                    role="button"
                    aria-label={cellLabel}
                    aria-pressed={isSelected}
                    tabIndex={rowIdx === fRow && colIdx === fCol ? 0 : -1}
                    className={cn(
                      'avail-cell h-8',
                      time.endsWith(':00') && rowIdx > 0 && slotMinutes < 60 && 'avail-cell--hour',
                      rowIdx === 0 && 'rounded-t',
                      rowIdx === times.length - 1 && 'rounded-b',
                      !bgColor && !isPending && !isSelected && 'avail-cell--empty',
                      isPending && 'avail-cell--pending-schedule',
                      isSelected && !isPending && 'avail-cell--scheduled',
                    )}
                    style={{
                      backgroundColor: (!isPending && !isSelected) ? bgColor : undefined,
                    }}
                    onPointerDown={(e) => handlePointerDown(e, rowIdx, colIdx)}
                    onPointerEnter={(e) => handlePointerEnter(e, rowIdx, colIdx)}
                  />
                )
              })}
            </>
          ))}
        </div>
      </div>
    </div>
  )
}
