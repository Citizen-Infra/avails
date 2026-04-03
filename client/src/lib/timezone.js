/**
 * Timezone conversion utilities for avails.
 * Uses Luxon for reliable timezone math (same library CabbageMeet uses).
 *
 * Slot keys are stored in the CREATOR's timezone (e.g. "2026-04-07T16:00" in Europe/Budapest).
 * The grid displays times in the VIEWER's local timezone.
 * Responses are converted back to creator's timezone for storage.
 */

import { DateTime } from 'luxon'

const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone

export function needsConversion(creatorTz) {
  return creatorTz && creatorTz !== viewerTz
}

export function getViewerTimezone() {
  return viewerTz
}

/**
 * Convert a creator-timezone slot key to the viewer's local timezone.
 * "2026-04-07T16:00" (Europe/Budapest) → "2026-04-07T10:00" (America/New_York)
 */
export function creatorSlotToViewerSlot(slotKey, creatorTz) {
  if (!creatorTz || creatorTz === viewerTz) return slotKey
  const [dateStr, timeStr] = slotKey.split('T')
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hour, minute] = timeStr.split(':').map(Number)

  const dt = DateTime.fromObject(
    { year, month, day, hour, minute },
    { zone: creatorTz }
  ).setZone(viewerTz)

  const y = dt.year
  const m = String(dt.month).padStart(2, '0')
  const d = String(dt.day).padStart(2, '0')
  const h = String(dt.hour).padStart(2, '0')
  const min = String(dt.minute).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

/**
 * Convert a viewer's local slot key to the creator's timezone.
 * "2026-04-07T10:00" (America/New_York) → "2026-04-07T16:00" (Europe/Budapest)
 */
export function viewerSlotToCreatorSlot(slotKey, creatorTz) {
  if (!creatorTz || creatorTz === viewerTz) return slotKey
  const [dateStr, timeStr] = slotKey.split('T')
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hour, minute] = timeStr.split(':').map(Number)

  const dt = DateTime.fromObject(
    { year, month, day, hour, minute },
    { zone: viewerTz }
  ).setZone(creatorTz)

  const y = dt.year
  const m = String(dt.month).padStart(2, '0')
  const d = String(dt.day).padStart(2, '0')
  const h = String(dt.hour).padStart(2, '0')
  const min = String(dt.minute).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

/**
 * Convert the poll's time range and dates from creator's TZ to viewer's local TZ.
 */
export function convertPollTimesToViewer(dates, timeRange, creatorTz) {
  if (!creatorTz || creatorTz === viewerTz) {
    return { dates, timeRange }
  }

  const sortedDates = [...dates].sort()
  const firstDate = sortedDates[0]
  const [year, month, day] = firstDate.split('-').map(Number)
  const [startH, startM] = timeRange.start.split(':').map(Number)
  const [endH, endM] = timeRange.end.split(':').map(Number)

  const startDt = DateTime.fromObject(
    { year, month, day, hour: startH, minute: startM },
    { zone: creatorTz }
  ).setZone(viewerTz)

  const endDt = DateTime.fromObject(
    { year, month, day, hour: endH, minute: endM },
    { zone: creatorTz }
  ).setZone(viewerTz)

  const viewerStart = `${String(startDt.hour).padStart(2, '0')}:${String(startDt.minute).padStart(2, '0')}`
  const viewerEnd = `${String(endDt.hour).padStart(2, '0')}:${String(endDt.minute).padStart(2, '0')}`

  // Dates might shift — collect all unique viewer dates
  const viewerDatesSet = new Set()
  for (const date of dates) {
    const [y, m, d] = date.split('-').map(Number)
    const sDt = DateTime.fromObject(
      { year: y, month: m, day: d, hour: startH, minute: startM },
      { zone: creatorTz }
    ).setZone(viewerTz)
    const eDt = DateTime.fromObject(
      { year: y, month: m, day: d, hour: endH, minute: endM },
      { zone: creatorTz }
    ).setZone(viewerTz)

    viewerDatesSet.add(`${sDt.year}-${String(sDt.month).padStart(2, '0')}-${String(sDt.day).padStart(2, '0')}`)
    viewerDatesSet.add(`${eDt.year}-${String(eDt.month).padStart(2, '0')}-${String(eDt.day).padStart(2, '0')}`)
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
