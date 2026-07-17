import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { cn } from '@/lib/utils'
import '../styles/avail-grid.css'

/**
 * WeeklyPatternGrid — paints a RECURRING weekly availability pattern
 * (Mon–Sun columns x time-of-day rows), unlike AvailGrid/SchedulingGrid which
 * paint specific calendar dates. Emits pattern.weekly = [{ day, startTime, endTime }]
 * (day: 0=Sun..6=Sat, matching JS Date#getDay() and the server's validator).
 *
 * Interaction model mirrors SchedulingGrid.jsx exactly: pointer drag is
 * constrained to a single column (one day) at a time, plus roving-tabIndex
 * keyboard navigation with Shift+Up/Down block-extension from an anchor.
 * Do NOT graft AvailGrid's multi-column rectangle drag here — a single day's
 * column is the natural unit for a weekly pattern.
 *
 * One deliberate deviation from SchedulingGrid: this grid must hold several
 * non-contiguous windows per day (SchedulingGrid only ever holds one active
 * block), so committing a drag/keypress TOGGLES the pending cells into the
 * existing selection (add or remove, based on the anchor cell's prior state)
 * instead of replacing the whole selection outright.
 */

const SLOT_MINUTES = 30
const START_TIME = '07:00'
const END_TIME = '22:00'
// Column order is Mon..Sun for display; values match day: 0=Sun..6=Sat.
// Exported so pages summarizing a published pattern (StandingAvailability)
// can render day names in the same order without redefining this map.
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
export const DAY_LABELS = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }
const EMPTY_WEEKLY = []

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function toHHMM(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0')
  const m = String(mins % 60).padStart(2, '0')
  return `${h}:${m}`
}

function generateTimes() {
  const times = []
  for (let m = toMinutes(START_TIME); m < toMinutes(END_TIME); m += SLOT_MINUTES) {
    times.push(toHHMM(m))
  }
  return times
}

// Expand windows [{day,startTime,endTime}] into a Set of "<day>T<slotStart>" cell keys.
function windowsToSlots(windows, times) {
  const timeSet = new Set(times)
  const set = new Set()
  for (const w of windows) {
    for (let m = toMinutes(w.startTime); m < toMinutes(w.endTime); m += SLOT_MINUTES) {
      const t = toHHMM(m)
      if (timeSet.has(t)) set.add(`${w.day}T${t}`)
    }
  }
  return set
}

// Collapse a Set of cell keys back into merged windows, one per contiguous run per day.
function slotsToWindows(selected) {
  const byDay = new Map()
  for (const key of selected) {
    const [dayStr, time] = key.split('T')
    const day = Number(dayStr)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(time)
  }
  const windows = []
  for (const [day, dayTimes] of byDay) {
    const sorted = [...dayTimes].sort()
    let start = sorted[0]
    let prevMinutes = toMinutes(sorted[0])
    for (let i = 1; i <= sorted.length; i++) {
      const cur = sorted[i]
      const curMinutes = cur ? toMinutes(cur) : null
      if (cur && curMinutes === prevMinutes + SLOT_MINUTES) {
        prevMinutes = curMinutes
        continue
      }
      windows.push({ day, startTime: start, endTime: toHHMM(prevMinutes + SLOT_MINUTES) })
      if (cur) {
        start = cur
        prevMinutes = curMinutes
      }
    }
  }
  windows.sort((a, b) => a.day - b.day || a.startTime.localeCompare(b.startTime))
  return windows
}

export default function WeeklyPatternGrid({ value, onChange }) {
  // Stable default — never pass new [] inline as a prop default (unstable
  // reference feeds useMemo below and would re-derive `selected` every render).
  value = value || EMPTY_WEEKLY

  const times = useMemo(() => generateTimes(), [])
  const days = DAY_ORDER

  const selected = useMemo(() => windowsToSlots(value, times), [value, times])

  // Drag state — refs for the pointer path, mirroring SchedulingGrid exactly.
  const downCell = useRef(null) // { row, col } | null
  const curCell = useRef(null)
  const downCellWasSelected = useRef(false)
  const [dragState, setDragState] = useState(null) // { pending: Set<string>, removing: boolean } | null
  const [focusCell, setFocusCell] = useState({ row: 0, col: 0 }) // roving tabindex
  const kbAnchor = useRef(null) // { row, col, wasSelected } — keyboard block-extension anchor
  const gridRef = useRef(null)

  const computePendingKeys = useCallback(
    (down, cur) => {
      // Constrain to same column (single day), same as SchedulingGrid.
      const col = down.col
      const day = days[col]
      const minRow = Math.min(down.row, cur.row)
      const maxRow = Math.max(down.row, cur.row)
      const keys = new Set()
      for (let r = minRow; r <= maxRow; r++) {
        if (r < times.length) keys.add(`${day}T${times[r]}`)
      }
      return keys
    },
    [days, times]
  )

  const handlePointerDown = useCallback(
    (e, row, col) => {
      e.preventDefault()
      setFocusCell({ row, col })
      const key = `${days[col]}T${times[row]}`
      const wasSelected = selected.has(key)
      downCell.current = { row, col }
      curCell.current = { row, col }
      downCellWasSelected.current = wasSelected
      setDragState({ pending: new Set([key]), removing: wasSelected })
    },
    [days, times, selected]
  )

  const handlePointerEnter = useCallback(
    (e, row, col) => {
      if (!downCell.current) return
      curCell.current = { row, col: downCell.current.col }
      const pending = computePendingKeys(downCell.current, curCell.current)
      setDragState({ pending, removing: downCellWasSelected.current })
    },
    [computePendingKeys]
  )

  const commitDrag = useCallback(() => {
    if (!downCell.current) return
    const pending = computePendingKeys(downCell.current, curCell.current)
    const next = new Set(selected)
    if (downCellWasSelected.current) {
      for (const k of pending) next.delete(k)
    } else {
      for (const k of pending) next.add(k)
    }
    onChange?.(slotsToWindows(next))
    downCell.current = null
    curCell.current = null
    setDragState(null)
  }, [selected, computePendingKeys, onChange])

  useEffect(() => {
    document.addEventListener('pointerup', commitDrag)
    return () => document.removeEventListener('pointerup', commitDrag)
  }, [commitDrag])

  // Keyboard navigation (WCAG 2.1.1) — roving tabindex, arrows move, Space/Enter
  // toggles one cell, Shift+Up/Down extends a block from the anchor's column,
  // applying the anchor's original state (add or remove) to the whole block.
  const fRow = Math.min(focusCell.row, Math.max(0, times.length - 1))
  const fCol = Math.min(focusCell.col, Math.max(0, days.length - 1))

  function focusCellAt(row, col) {
    gridRef.current?.querySelector(`[data-row="${row}"][data-col="${col}"]`)?.focus()
  }

  function handleGridKeyDown(e) {
    const maxRow = times.length - 1
    const maxCol = days.length - 1
    let r = fRow
    let c = fCol
    if (e.key === 'ArrowUp') r = Math.max(0, fRow - 1)
    else if (e.key === 'ArrowDown') r = Math.min(maxRow, fRow + 1)
    else if (e.key === 'ArrowLeft') c = Math.max(0, fCol - 1)
    else if (e.key === 'ArrowRight') c = Math.min(maxCol, fCol + 1)
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const key = `${days[fCol]}T${times[fRow]}`
      kbAnchor.current = { row: fRow, col: fCol, wasSelected: selected.has(key) }
      const next = new Set(selected)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      onChange?.(slotsToWindows(next))
      return
    } else {
      return
    }
    e.preventDefault()
    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (!kbAnchor.current || kbAnchor.current.col !== fCol) {
        const anchorKey = `${days[fCol]}T${times[fRow]}`
        kbAnchor.current = { row: fRow, col: fCol, wasSelected: selected.has(anchorKey) }
      }
      const col = kbAnchor.current.col
      const day = days[col]
      const lo = Math.min(kbAnchor.current.row, r)
      const hi = Math.max(kbAnchor.current.row, r)
      const next = new Set(selected)
      for (let i = lo; i <= hi; i++) {
        const k = `${day}T${times[i]}`
        if (kbAnchor.current.wasSelected) next.delete(k)
        else next.add(k)
      }
      onChange?.(slotsToWindows(next))
    }
    setFocusCell({ row: r, col: c })
    requestAnimationFrame(() => focusCellAt(r, c))
  }

  const windowCount = value.length
  const dayCount = new Set(value.map((w) => w.day)).size

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[#8a8580]">
          Drag to paint the times you're usually free. Drag again over a painted cell to clear it.
        </p>
        {windowCount > 0 && (
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm font-medium text-[#0d9488]">
              {windowCount} {windowCount === 1 ? 'window' : 'windows'} across {dayCount} {dayCount === 1 ? 'day' : 'days'}
            </span>
            <button
              type="button"
              onClick={() => onChange?.([])}
              className="text-sm text-[#8a8580] hover:text-[#1a1a1a] underline underline-offset-2 transition-colors"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      <div className="select-none overflow-hidden rounded-lg border border-[#d8d4cf]">
        <div
          className="overflow-auto max-h-[28rem]"
          style={{ touchAction: 'none', cursor: 'crosshair' }}
        >
          <div
            ref={gridRef}
            role="group"
            aria-label="Weekly availability painter. Use arrow keys to move, Space to toggle a slot, Shift with up or down to extend a block."
            onKeyDown={handleGridKeyDown}
            className="grid w-full"
            style={{
              gridTemplateColumns: `clamp(3rem, 12vw, 5rem) repeat(${days.length}, 1fr)`,
            }}
          >
            {/* Header — sticky so day labels stay visible while scrolling a tall grid */}
            <div className="sticky top-0 z-[2] bg-[#faf9f6]" />
            {days.map((day) => (
              <div
                key={day}
                className="sticky top-0 z-[2] flex flex-col items-center gap-0.5 pb-2 pt-1 text-center bg-[#faf9f6]"
              >
                <span className="text-[11px] font-medium text-[#8a8580] uppercase tracking-[0.1em]">
                  {DAY_LABELS[day]}
                </span>
              </div>
            ))}

            {/* Rows */}
            {times.map((time, rowIdx) => (
              <>
                <div key={`label-${time}`} className="pr-2 flex items-start justify-end -mt-[7px]">
                  <span
                    className={cn(
                      'text-xs tabular-nums leading-none',
                      time.endsWith(':00') ? 'text-[#1a1a1a] font-medium' : 'text-[#a09a94]'
                    )}
                  >
                    {time}
                  </span>
                </div>
                {days.map((day, colIdx) => {
                  const key = `${day}T${time}`
                  const isSelected = selected.has(key)
                  const isPendingAdd = dragState && !dragState.removing && dragState.pending.has(key)
                  const isPendingRemove = dragState && dragState.removing && dragState.pending.has(key)
                  const cellLabel =
                    `${DAY_LABELS[day]} at ${time}` + (isSelected ? ', selected' : ', not selected')

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
                        time.endsWith(':00') && rowIdx > 0 && 'avail-cell--hour',
                        !isSelected && !isPendingAdd && !isPendingRemove && 'avail-cell--empty',
                        isPendingAdd && 'avail-cell--pending-add',
                        isPendingRemove && 'avail-cell--pending-remove',
                        isSelected && !isPendingAdd && !isPendingRemove && 'avail-cell--mine',
                      )}
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
    </div>
  )
}
