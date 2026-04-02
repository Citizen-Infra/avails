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

function slotColor(count, total) {
  if (!count || !total) return null
  const ratio = count / total
  // lightness from 85% (1 person) to 40% (all people)
  const lightness = 85 - ratio * 45
  return `hsl(142, 60%, ${lightness}%)`
}

const BUSY_BG = 'rgba(239, 68, 68, 0.12)' // light red background for busy slots
const BUSY_PATTERN =
  'repeating-linear-gradient(45deg, rgba(239,68,68,0.25) 0px, rgba(239,68,68,0.25) 2px, transparent 2px, transparent 6px)'

export default function AvailGrid({
  dates = [],
  timeRange = { start: '09:00', end: '17:00' },
  slotMinutes = 30,
  responses = [],
  mySlots = new Set(),
  onSlotsChange,
  readOnly = false,
  highlightName = null,
  busySlots = new Set(),
  slotEvents = {},
  onHoverSlot,
}) {
  const containerRef = useRef(null)

  // Drag state refs (not state — avoid re-renders on every pointermove)
  const downCell = useRef(null)   // { row, col } | null
  const curCell = useRef(null)    // { row, col } | null
  const downCellWasSelected = useRef(false)

  // Only this triggers re-renders — for CSS class + pending visual
  const [dragState, setDragState] = useState(null) // null | { pending: Set<string>, removing: boolean }

  const times = useMemo(
    () => generateSlots(dates, timeRange, slotMinutes),
    [dates, timeRange, slotMinutes]
  )

  const heatmap = useMemo(
    () => computeHeatmap(responses, dates, times),
    [responses, dates, times]
  )

  const highlightSlots = useMemo(() => {
    if (!highlightName) return new Set()
    const r = responses.find((r) => r.name === highlightName)
    return r ? new Set(r.slots) : new Set()
  }, [responses, highlightName])

  const totalRespondents = responses.length

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
          if (r < times.length && c < dates.length) {
            keys.add(`${dates[c]}T${times[r]}`)
          }
        }
      }
      return keys
    },
    [dates, times]
  )

  const handlePointerDown = useCallback(
    (e, row, col) => {
      if (readOnly) return
      e.preventDefault()
      const key = `${dates[col]}T${times[row]}`
      const wasSelected = mySlots.has(key)
      downCell.current = { row, col }
      curCell.current = { row, col }
      downCellWasSelected.current = wasSelected
      const pending = new Set([key])
      setDragState({ pending, removing: wasSelected })
    },
    [readOnly, mySlots, dates, times]
  )

  const handlePointerEnter = useCallback(
    (e, row, col) => {
      if (downCell.current) {
        // Drag in progress — update selection rectangle
        if (readOnly) return
        curCell.current = { row, col }
        const pending = computePendingKeys(downCell.current, { row, col })
        setDragState({ pending, removing: downCellWasSelected.current })
      } else {
        // Not dragging — fire hover slot callback
        const key = `${dates[col]}T${times[row]}`
        onHoverSlot?.(key)
      }
    },
    [readOnly, computePendingKeys, dates, times, onHoverSlot]
  )

  // Commit on pointerup — attached to document so it fires even outside the grid
  const commitDrag = useCallback(() => {
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
  }, [mySlots, onSlotsChange, computePendingKeys])

  // Document-level pointerup listener
  useEffect(() => {
    document.addEventListener('pointerup', commitDrag)
    return () => document.removeEventListener('pointerup', commitDrag)
  }, [commitDrag])

  function getTooltipContent(date, time) {
    const key = `${date}T${time}`
    const count = heatmap[key] || 0
    if (count === 0) return null
    const names = responses
      .filter((r) => r.slots.includes(key))
      .map((r) => r.name)
    return `${count}/${totalRespondents} available — ${names.join(', ')}`
  }

  const colCount = dates.length + 1 // 1 for time labels

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={containerRef}
        className={cn('select-none overflow-x-auto', dragState && 'avail-grid--dragging')}
        style={{ touchAction: 'none' }}
        onPointerLeave={() => { if (!downCell.current) onHoverSlot?.(null) }}
      >
        <div
          className="grid w-full rounded-lg border border-[#d8d4cf] overflow-hidden"
          style={{ gridTemplateColumns: `5rem repeat(${dates.length}, minmax(8rem, 1fr))` }}
        >
          {/* Header row */}
          <div /> {/* empty corner */}
          {dates.map((date) => {
            const { dayName, monthDay } = formatDate(date)
            return (
              <div
                key={date}
                className="flex flex-col items-center pb-2 pt-1 text-center"
              >
                <span className="text-sm font-medium text-[#6b6560] uppercase tracking-wide">
                  {dayName}
                </span>
                <span className="text-sm text-[#1a1a1a] font-medium">{monthDay}</span>
              </div>
            )
          })}

          {/* Time rows */}
          {times.map((time, rowIdx) => (
            <>
              {/* Time label */}
              <div
                key={`label-${time}`}
                className="pr-2 flex items-center justify-end"
              >
                <span className="text-sm text-[#6b6560] tabular-nums leading-none">
                  {time}
                </span>
              </div>

              {/* Slot cells for each date */}
              {dates.map((date, colIdx) => {
                const key = `${date}T${time}`
                const isMine = mySlots.has(key)
                const isBusy = busySlots.has(key)
                const isHighlighted = highlightSlots.has(key)
                const heatCount = heatmap[key] || 0
                const bgColor = heatCount > 0 ? slotColor(heatCount, totalRespondents) : undefined
                const tooltipText = getTooltipContent(date, time)

                const isPendingAdd = dragState && !dragState.removing && dragState.pending.has(key)
                const isPendingRemove = dragState && dragState.removing && dragState.pending.has(key)

                const eventName = isBusy ? slotEvents[key] : null

                const cell = (
                  <div
                    key={key}
                    className={cn(
                      'avail-cell h-10 cursor-pointer overflow-hidden',
                      rowIdx === 0 && 'rounded-t',
                      rowIdx === times.length - 1 && 'rounded-b',
                      isMine && !isPendingRemove && !isPendingAdd && 'avail-cell--mine',
                      isHighlighted && !isMine && 'avail-cell--highlighted',
                      readOnly && 'avail-cell--readonly cursor-default',
                      !isMine && !bgColor && !isPendingAdd && !isPendingRemove && !isBusy && 'avail-cell--empty',
                      isPendingAdd && 'avail-cell--pending-add',
                      isPendingRemove && 'avail-cell--pending-remove',
                    )}
                    style={{
                      backgroundColor: isBusy && !isMine && !bgColor
                        ? BUSY_BG
                        : ((!isPendingAdd && !isPendingRemove && !isMine) ? bgColor : undefined),
                      backgroundImage: isBusy ? BUSY_PATTERN : undefined,
                    }}
                    onPointerDown={(e) => handlePointerDown(e, rowIdx, colIdx)}
                    onPointerEnter={(e) => handlePointerEnter(e, rowIdx, colIdx)}
                  >
                    {eventName && (
                      <span className="absolute inset-0 flex items-center px-1.5 text-[10px] leading-tight text-red-700/70 font-medium truncate pointer-events-none z-[1]">
                        {eventName}
                      </span>
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
    </TooltipProvider>
  )
}
