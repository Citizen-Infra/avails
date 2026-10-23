// Data signal is separate from the brand action/selection palette.
export function slotColor(count, total) {
  if (!count || !total) return null
  const alpha = 0.2 + 0.7 * (count / total)
  return `color-mix(in srgb, var(--cibc-data-high) ${alpha * 100}%, var(--cibc-data-empty))`
}

export function dateCapacity(width, rootSize = 16) {
  return Math.max(1, Math.min(7, Math.floor((width - 4 * rootSize) / (6 * rootSize))))
}
