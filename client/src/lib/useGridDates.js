import { useLayoutEffect, useMemo, useState } from 'react'
import { paginateDates } from './datePagination'
import { dateCapacity } from './gridPresentation'

// Both dated grids retain balanced pages and slot-key identity. Available space
// determines columns, instead of shrinking date/time labels to fit seven dates.
export function useGridDates(dates, containerRef) {
  const [capacity, setCapacity] = useState(7)
  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) return
    const update = () => setCapacity(dateCapacity(
      node.getBoundingClientRect().width,
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
    ))
    const observer = new ResizeObserver(update)
    observer.observe(node)
    observer.observe(document.documentElement)
    update()
    return () => observer.disconnect()
  }, [containerRef])
  return useMemo(() => paginateDates(dates, capacity), [dates, capacity])
}
