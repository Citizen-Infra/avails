import { useRef, useState, useCallback, useMemo } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

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
}) {
  const isDragging = useRef(false)
  const dragMode = useRef('add') // 'add' | 'remove'
  const containerRef = useRef(null)

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

  const handlePointerDown = useCallback(
    (e, key) => {
      if (readOnly) return
      e.preventDefault()
      isDragging.current = true
      dragMode.current = mySlots.has(key) ? 'remove' : 'add'
      const next = new Set(mySlots)
      if (dragMode.current === 'add') next.add(key)
      else next.delete(key)
      onSlotsChange?.(next)
    },
    [readOnly, mySlots, onSlotsChange]
  )

  const handlePointerEnter = useCallback(
    (e, key) => {
      if (!isDragging.current || readOnly) return
      const next = new Set(mySlots)
      if (dragMode.current === 'add') next.add(key)
      else next.delete(key)
      onSlotsChange?.(next)
    },
    [readOnly, mySlots, onSlotsChange]
  )

  const endDrag = useCallback(() => {
    isDragging.current = false
  }, [])

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
        className="select-none overflow-x-auto"
        style={{ touchAction: 'none' }}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <div
          className="inline-grid min-w-max"
          style={{ gridTemplateColumns: `4rem repeat(${dates.length}, minmax(2.5rem, 1fr))` }}
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
          {times.map((time, timeIdx) => (
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
              {dates.map((date) => {
                const key = `${date}T${time}`
                const isMine = mySlots.has(key)
                const isBusy = busySlots.has(key)
                const isHighlighted = highlightSlots.has(key)
                const heatCount = heatmap[key] || 0
                const bgColor = heatCount > 0 ? slotColor(heatCount, totalRespondents) : undefined
                const tooltipText = getTooltipContent(date, time)

                const cell = (
                  <div
                    key={key}
                    className={cn(
                      'relative h-6 cursor-pointer border border-border/40',
                      timeIdx === 0 && 'rounded-t',
                      timeIdx === times.length - 1 && 'rounded-b',
                      isMine && 'ring-2 ring-inset ring-green-500',
                      isHighlighted && !isMine && 'ring-2 ring-inset ring-blue-500',
                      readOnly && 'cursor-default',
                      !isMine && !bgColor && 'bg-muted/30'
                    )}
                    style={{
                      backgroundColor: bgColor,
                      backgroundImage: isBusy ? BUSY_PATTERN : undefined,
                    }}
                    onPointerDown={(e) => handlePointerDown(e, key)}
                    onPointerEnter={(e) => handlePointerEnter(e, key)}
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
