import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { cn } from '@/lib/utils'
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

function slotColor(count, total) {
  if (!count || !total) return null
  const ratio = count / total
  const lightness = 85 - ratio * 45
  return `hsl(142, 60%, ${lightness}%)`
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

  const computePendingKeys = useCallback((down, cur) => {
    // Constrain to same column (single day)
    const col = down.col
    const minRow = Math.min(down.row, cur.row)
    const maxRow = Math.max(down.row, cur.row)
    const keys = new Set()
    for (let r = minRow; r <= maxRow; r++) {
      if (r < times.length && col < dates.length) {
        keys.add(`${dates[col]}T${times[r]}`)
      }
    }
    return keys
  }, [dates, times])

  const handlePointerDown = useCallback((e, row, col) => {
    e.preventDefault()
    downCell.current = { row, col }
    curCell.current = { row, col }
    const key = `${dates[col]}T${times[row]}`
    setDragPending(new Set([key]))
  }, [dates, times])

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

  return (
    <div className="space-y-4">
      {/* Scheduling bar */}
      <div className="rounded-lg bg-[#0d9488] text-white px-6 py-4 flex items-center justify-between">
        <p className="text-base font-medium">Select a time block on the grid</p>
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

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Grid */}
      <div
        className="select-none overflow-x-auto"
        style={{ touchAction: 'none', cursor: 'crosshair' }}
      >
        <div
          className="grid w-full"
          style={{ gridTemplateColumns: `5rem repeat(${dates.length}, minmax(8rem, 1fr))` }}
        >
          {/* Header */}
          <div />
          {dates.map((date) => {
            const { dayName, monthDay } = formatDate(date)
            return (
              <div key={date} className="flex flex-col items-center pb-2 pt-1 text-center">
                <span className="text-sm font-medium text-[#6b6560] uppercase tracking-wide">{dayName}</span>
                <span className="text-sm text-[#1a1a1a] font-medium">{monthDay}</span>
              </div>
            )
          })}

          {/* Rows */}
          {times.map((time, rowIdx) => (
            <>
              <div key={`label-${time}`} className="pr-2 flex items-center justify-end">
                <span className="text-sm text-[#6b6560] tabular-nums leading-none">{time}</span>
              </div>
              {dates.map((date, colIdx) => {
                const key = `${date}T${time}`
                const heatCount = heatmap[key] || 0
                const bgColor = heatCount > 0 ? slotColor(heatCount, totalRespondents) : undefined
                const isPending = dragPending && dragPending.has(key)
                const isSelected = selectedSlots.has(key)

                return (
                  <div
                    key={key}
                    className={cn(
                      'avail-cell h-10',
                      rowIdx === 0 && 'rounded-t',
                      rowIdx === times.length - 1 && 'rounded-b',
                      !bgColor && !isPending && !isSelected && 'bg-muted/30',
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
