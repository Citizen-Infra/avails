import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useGridDates } from '@/lib/useGridDates'
import { slotOpacity } from '@/lib/gridPresentation'
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

  // Date pagination mirrors AvailGrid. Pages are balanced while staying at seven
  // dates or fewer; selection persists because slot keys are page-independent.
  const [page, setPage] = useState(0)
  const datePages = useGridDates(dates, gridRef)
  const totalPages = datePages.length
  const pageIndex = Math.min(page, Math.max(0, totalPages - 1))
  const visibleDates = datePages[pageIndex] || []
  const hasLeft = pageIndex > 0
  const hasRight = pageIndex < totalPages - 1

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

  // Touch pointers retain implicit capture on the starting cell, so entering
  // another row does not fire pointerenter. Hit-test movement like AvailGrid,
  // while preserving this picker's single-date constraint.
  const handlePointerMove = useCallback((e) => {
    if (!downCell.current) return
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-row]')
    if (!cell || !gridRef.current?.contains(cell)) return
    const row = Number(cell.dataset.row)
    if (!Number.isInteger(row) || row === curCell.current?.row) return
    curCell.current = { row, col: downCell.current.col }
    setDragPending(computePendingKeys(downCell.current, curCell.current))
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
    document.addEventListener('pointermove', handlePointerMove)
    return () => {
      document.removeEventListener('pointerup', commitDrag)
      document.removeEventListener('pointermove', handlePointerMove)
    }
  }, [commitDrag, handlePointerMove])

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
      <div className="rounded-sm bg-primary text-primary-foreground px-6 py-4 space-y-3 xl:space-y-0 xl:flex xl:items-center xl:justify-between xl:gap-4">
        <p className="text-base font-medium">Select a time block on the grid</p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Add-to-calendar picker */}
          {googleConnected && writableCalendars && writableCalendars.length > 0 ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-primary-foreground">Add to:</span>
              <select
                value={chosenCalendarId}
                onChange={(e) => onChooseCalendar(e.target.value)}
                className="rounded-sm bg-card text-foreground px-2 py-1.5 text-sm border-0 focus:ring-2 focus:ring-ring"
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
              className="text-sm underline underline-offset-2 hover:decoration-2"
            >
              Connect Google Calendar to add event
            </button>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onCancel}
              className="text-base px-4 py-2 rounded-sm border border-current hover:underline transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={confirmDisabled}
              className="text-base px-4 py-2 rounded-sm bg-card text-primary font-medium hover:bg-card/90 transition-colors disabled:opacity-50"
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Pagination arrows + month-range header — mirrors AvailGrid */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            aria-label="Show previous dates"
            onClick={() => setPage(pageIndex - 1)}
            disabled={!hasLeft}
            className={cn('inline-flex h-11 w-11 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', hasLeft ? 'text-foreground hover:bg-muted' : 'text-muted-foreground cursor-default')}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4l-6 6 6 6" /></svg>
          </button>
          <div aria-live="polite" className="text-center text-sm font-medium text-foreground-secondary">
            <span>{formatDate(visibleDates[0]).monthDay} — {formatDate(visibleDates[visibleDates.length - 1]).monthDay}</span>
            <span className="ml-2 font-normal">Page {pageIndex + 1} of {totalPages}</span>
          </div>
          <button
            type="button"
            aria-label="Show next dates"
            onClick={() => setPage(pageIndex + 1)}
            disabled={!hasRight}
            className={cn('inline-flex h-11 w-11 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', hasRight ? 'text-foreground hover:bg-muted' : 'text-muted-foreground cursor-default')}
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
          className="avails-dated-grid grid w-full"
          style={{
            gridTemplateColumns: `var(--avails-grid-time-width) repeat(${visibleDates.length}, minmax(0, 1fr))`,
          }}
        >
          {/* Header */}
          <div />
          {visibleDates.map((date) => {
            const { dayName, monthDay } = formatDate(date)
            return (
              <div key={date} className="flex flex-col items-center gap-0.5 pb-2 pt-1 text-center">
                <span className="avails-grid-label font-medium text-muted-foreground">{dayName}</span>
                <span className="text-base text-foreground font-semibold tabular-nums leading-tight">{monthDay}</span>
              </div>
            )
          })}

          {/* Rows */}
          {times.map((time, rowIdx) => (
            <>
              <div key={`label-${time}`} className={cn('pr-2 flex items-start justify-end', rowIdx > 0 && '-mt-[0.4375rem]')}>
                <span className={cn(
                  'avails-grid-time tabular-nums',
                  time.endsWith(':00') ? 'text-foreground font-medium' : 'text-muted-foreground'
                )}>
                  {time}
                </span>
              </div>
              {visibleDates.map((date, colIdx) => {
                const key = `${date}T${time}`
                const heatCount = heatmap[key] || 0
                const isPending = dragPending && dragPending.has(key)
                const isSelected = selectedSlots.has(key)
                const layerCount = heatCount + (isPending || isSelected ? 1 : 0)
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
                    data-layer-count={layerCount}
                    role="button"
                    aria-label={cellLabel}
                    aria-pressed={isSelected}
                    tabIndex={rowIdx === fRow && colIdx === fCol ? 0 : -1}
                    className={cn(
                      'avail-cell',
                      time.endsWith(':00') && rowIdx > 0 && slotMinutes < 60 && 'avail-cell--hour',
                      rowIdx === 0 && 'rounded-t',
                      rowIdx === times.length - 1 && 'rounded-b',
                      layerCount === 0 && 'avail-cell--empty',
                      isPending && 'avail-cell--pending-schedule',
                      isSelected && !isPending && 'avail-cell--scheduled',
                    )}
                    style={{
                      '--avails-slot-opacity': `${(slotOpacity(layerCount) * 100).toFixed(4)}%`,
                    }}
                    onPointerDown={(e) => handlePointerDown(e, rowIdx, colIdx)}
                    onPointerEnter={(e) => handlePointerEnter(e, rowIdx, colIdx)}
                  >
                    {(isPending || isSelected) && (
                      <svg className="avail-cell__mark" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                )
              })}
            </>
          ))}
        </div>
      </div>
    </div>
  )
}
