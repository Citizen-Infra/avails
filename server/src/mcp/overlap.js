/**
 * @param {Array} responses - array of { name, slots: ['YYYY-MM-DDThh:mm', ...] }
 * @returns {Array} sorted by count desc, then slot asc: { slot, participants, count }
 */
export function computeBestSlots(responses) {
  const slotMap = new Map(); // slot string → Set of participant names

  for (const response of responses) {
    const name = response.name || 'Anonymous';
    if (!Array.isArray(response.slots)) continue;
    for (const slot of response.slots) {
      if (!slotMap.has(slot)) slotMap.set(slot, new Set());
      slotMap.get(slot).add(name);
    }
  }

  const bestSlots = [];
  for (const [slot, participants] of slotMap) {
    bestSlots.push({
      slot,
      participants: [...participants],
      count: participants.size,
    });
  }

  bestSlots.sort((a, b) => b.count - a.count || a.slot.localeCompare(b.slot));
  return bestSlots;
}
