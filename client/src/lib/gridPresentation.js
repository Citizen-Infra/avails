// Fixed translucent vote layers: a lone vote never becomes opaque just because
// it is the poll's maximum. Leave the underlying slot structure visible.
export function slotOpacity(count) {
  if (!Number.isFinite(count) || count <= 0) return 0
  return Math.min(0.88, 1 - 0.78 ** count)
}

// An edit replaces the saved personal vote, rather than counting it twice.
// Read-only and focused-person views continue to show only saved responses.
export function slotLayerCount(count, { selected = false, saved = false, editable = false, preview = null } = {}) {
  const votes = Number.isFinite(count) ? Math.max(0, count) : 0
  if (!editable) return votes
  const own = preview === null ? selected : preview === 'add'
  return Math.max(0, votes - Number(saved)) + Number(own)
}

export function dateCapacity(width, rootSize = 16) {
  return Math.max(1, Math.min(7, Math.floor((width - 4 * rootSize) / (6 * rootSize))))
}
