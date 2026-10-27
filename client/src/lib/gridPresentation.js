// Each vote adds a blue layer. More votes in the poll make each layer lighter;
// normalize the composite so the largest overlap (not unanimity) is solid blue.
export function slotColor(count, maxCount) {
  if (count <= 0 || maxCount <= 0) return null
  const layerOpacity = 1 / maxCount
  const composite = 1 - (1 - layerOpacity) ** Math.min(count, maxCount)
  const peak = 1 - (1 - layerOpacity) ** maxCount
  const alpha = composite / peak
  return `color-mix(in srgb, var(--cibc-data-high) ${alpha * 100}%, var(--cibc-data-empty))`
}

export function dateCapacity(width, rootSize = 16) {
  return Math.max(1, Math.min(7, Math.floor((width - 4 * rootSize) / (6 * rootSize))))
}
