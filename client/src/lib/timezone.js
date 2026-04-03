/**
 * Timezone conversion utilities for avails.
 *
 * Slot keys are stored in the CREATOR's timezone (e.g. "2026-04-07T16:00" in Europe/Budapest).
 * The grid needs to display times in the VIEWER's local timezone.
 * When saving responses, viewer's local slot keys must be converted back to creator's timezone.
 */

const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone

/**
 * Check if timezone conversion is needed.
 */
export function needsConversion(creatorTz) {
  return creatorTz && creatorTz !== viewerTz
}

export function getViewerTimezone() {
  return viewerTz
}

/**
 * Convert a wall-clock time in a specific timezone to a UTC Date object.
 * e.g. "2026-04-07", "16:00", "Europe/Budapest" → Date(2026-04-07T14:00:00Z)
 */
function wallClockToUTC(dateStr, timeStr, tz) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hour, minute] = timeStr.split(':').map(Number)

  // Start with a guess: treat the wall-clock time as UTC
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute))

  // See what this UTC time looks like in the target timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric',
  }).formatToParts(guess)

  const tzHour = Number(parts.find(p => p.type === 'hour').value)
  const tzMin = Number(parts.find(p => p.type === 'minute').value)
  const tzDay = Number(parts.find(p => p.type === 'day').value)

  // The offset is the difference between what we wanted and what we got
  const diffMinutes = (day - tzDay) * 1440 + (hour - tzHour) * 60 + (minute - tzMin)

  return new Date(guess.getTime() + diffMinutes * 60000)
}

/**
 * Format a Date to "YYYY-MM-DD" using local time.
 */
function formatLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Format a Date to "HH:MM" using local time.
 */
function formatLocalTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Convert a creator-timezone slot key to the viewer's local timezone.
 * "2026-04-07T16:00" (Europe/Budapest) → "2026-04-07T10:00" (America/New_York)
 */
export function creatorSlotToViewerSlot(slotKey, creatorTz) {
  if (!creatorTz || creatorTz === viewerTz) return slotKey
  const [dateStr, timeStr] = slotKey.split('T')
  const utc = wallClockToUTC(dateStr, timeStr, creatorTz)
  return `${formatLocalDate(utc)}T${formatLocalTime(utc)}`
}

/**
 * Convert a viewer's local slot key to the creator's timezone.
 * "2026-04-07T10:00" (America/New_York) → "2026-04-07T16:00" (Europe/Budapest)
 */
export function viewerSlotToCreatorSlot(slotKey, creatorTz) {
  if (!creatorTz || creatorTz === viewerTz) return slotKey
  const [dateStr, timeStr] = slotKey.split('T')
  // Convert from viewer's local to UTC, then to creator's timezone
  const utc = wallClockToUTC(dateStr, timeStr, viewerTz)

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: creatorTz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(utc)

  const y = parts.find(p => p.type === 'year').value
  const m = parts.find(p => p.type === 'month').value
  const d = parts.find(p => p.type === 'day').value
  const h = parts.find(p => p.type === 'hour').value
  const min = parts.find(p => p.type === 'minute').value
  return `${y}-${m}-${d}T${h}:${min}`
}

/**
 * Convert the poll's time range and dates from creator's TZ to viewer's local TZ.
 * Returns adjusted { dates, timeRange } for the grid to display.
 */
export function convertPollTimesToViewer(dates, timeRange, creatorTz) {
  if (!creatorTz || creatorTz === viewerTz) {
    return { dates, timeRange }
  }

  // Convert start and end times of the first date to get the viewer's time range
  const firstDate = [...dates].sort()[0]
  const startUtc = wallClockToUTC(firstDate, timeRange.start, creatorTz)
  const endUtc = wallClockToUTC(firstDate, timeRange.end, creatorTz)

  const viewerStart = formatLocalTime(startUtc)
  const viewerEnd = formatLocalTime(endUtc)

  // Dates might shift — e.g. 01:00 Budapest = previous day 19:00 New York
  // Collect all unique viewer dates across all creator dates
  const viewerDatesSet = new Set()
  for (const date of dates) {
    const sUtc = wallClockToUTC(date, timeRange.start, creatorTz)
    const eUtc = wallClockToUTC(date, timeRange.end, creatorTz)
    viewerDatesSet.add(formatLocalDate(sUtc))
    viewerDatesSet.add(formatLocalDate(eUtc))
  }

  return {
    dates: [...viewerDatesSet].sort(),
    timeRange: { start: viewerStart, end: viewerEnd },
  }
}

/**
 * Convert an array of creator-timezone slot keys to viewer's timezone.
 */
export function convertSlotsToViewer(slots, creatorTz) {
  if (!creatorTz || creatorTz === viewerTz) return slots
  return slots.map(s => creatorSlotToViewerSlot(s, creatorTz))
}

/**
 * Convert a Set of viewer-timezone slot keys to creator's timezone for storage.
 */
export function convertSlotsToCreator(slots, creatorTz) {
  if (!creatorTz || creatorTz === viewerTz) return Array.from(slots)
  return Array.from(slots).map(s => viewerSlotToCreatorSlot(s, creatorTz))
}
