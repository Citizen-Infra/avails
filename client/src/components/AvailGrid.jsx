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

const BUSY_PATTERN =
  'repeating-linear-gradient(45deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 2px, transparent 2px, transparent 8px)'

const DEFAULT_TIME_RANGE = { start: '09:00', end: '17:00' }
const EMPTY_SET = new Set()
const EMPTY_ARRAY = []

export default function AvailGrid({
  dates = EMPTY_ARRAY,
  timeRange = DEFAULT_TIME_RANGE,
  slotMinutes = 30,
  responses = EMPTY_ARRAY,
  mySlots = EMPTY_SET,
  onSlotsChange,
  readOnly = false,
  highlightName = null,
  busySlots = EMPTY_SET,
  onHoverSlot,
  mode = 'respond', // 'respond' | 'view' | 'schedule'
  onScheduleSelect,
  scheduledSlots = EMPTY_SET,
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
      if (mode === 'view') return
      if (mode === 'respond' && readOnly) return
      e.preventDefault()
      const key = `${dates[col]}T${times[row]}`
      if (mode === 'schedule') {
        // Schedule mode: always adding, never removing
        downCell.current = { row, col }
        curCell.current = { row, col }
        downCellWasSelected.current = false
        const pending = new Set([key])
        setDragState({ pending, removing: false })
        return
      }
      const wasSelected = mySlots.has(key)
      downCell.current = { row, col }
      curCell.current = { row, col }
      downCellWasSelected.current = wasSelected
      const pending = new Set([key])
      setDragState({ pending, removing: wasSelected })
    },
    [mode, readOnly, mySlots, dates, times]
  )

  const handlePointerEnter = useCallback(
    (e, row, col) => {
      if (downCell.current) {
        // Drag in progress — update selection rectangle
        if (mode === 'view') return
        if (mode === 'respond' && readOnly) return
        // In schedule mode, constrain to same column as downCell
        const effectiveCol = mode === 'schedule' ? downCell.current.col : col
        curCell.current = { row, col: effectiveCol }
        const pending = computePendingKeys(downCell.current, { row, col: effectiveCol })
        setDragState({ pending, removing: downCellWasSelected.current })
      } else {
        // Not dragging — fire hover slot callback
        const key = `${dates[col]}T${times[row]}`
        onHoverSlot?.(key)
      }
    },
    [mode, readOnly, computePendingKeys, dates, times, onHoverSlot]
  )

  // Commit on pointerup — attached to document so it fires even outside the grid
  const commitDrag = useCallback(() => {
    if (!downCell.current) return
    const pending = computePendingKeys(downCell.current, curCell.current)

    if (mode === 'schedule') {
      // Schedule mode: pass sorted slot keys to callback
      const sorted = Array.from(pending).sort()
      onScheduleSelect?.(sorted)
      downCell.current = null
      curCell.current = null
      setDragState(null)
      return
    }

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
  }, [mode, mySlots, onSlotsChange, onScheduleSelect, computePendingKeys])

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
          className="grid w-full"
          style={{ gridTemplateColumns: `4.5rem repeat(${dates.length}, minmax(5rem, 1fr))` }}
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
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {dayName}
                </span>
                <span className="text-xs text-foreground">{monthDay}</span>
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
                <span className="text-xs text-muted-foreground tabular-nums leading-none">
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
                const isPendingSchedule = mode === 'schedule' && dragState && dragState.pending.has(key)
                const isScheduled = scheduledSlots.has(key)
                const isViewOrScheduleReadOnly = mode === 'view' || (mode === 'respond' && readOnly)

                const cell = (
                  <div
                    key={key}
                    className={cn(
                      'avail-cell h-8 cursor-pointer',
                      rowIdx === 0 && 'rounded-t',
                      rowIdx === times.length - 1 && 'rounded-b',
                      isMine && !isPendingRemove && 'ring-2 ring-inset ring-green-500',
                      isHighlighted && !isMine && 'ring-2 ring-inset ring-blue-500',
                      isViewOrScheduleReadOnly && mode !== 'schedule' && 'avail-cell--readonly cursor-default',
                      mode === 'schedule' && 'cursor-crosshair',
                      !isMine && !bgColor && !isPendingAdd && !isPendingSchedule && !isScheduled && 'bg-muted/30',
                      isPendingSchedule && 'avail-cell--pending-schedule',
                      !isPendingSchedule && isPendingAdd && 'avail-cell--pending-add',
                      isPendingRemove && 'avail-cell--pending-remove',
                      isScheduled && !isPendingSchedule && 'avail-cell--scheduled',
                    )}
                    style={{
                      backgroundColor: (!isPendingAdd && !isPendingRemove && !isPendingSchedule && !isScheduled) ? bgColor : undefined,
                      backgroundImage: isBusy ? BUSY_PATTERN : undefined,
                    }}
                    onPointerDown={(e) => handlePointerDown(e, rowIdx, colIdx)}
                    onPointerEnter={(e) => handlePointerEnter(e, rowIdx, colIdx)}
                  />
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
