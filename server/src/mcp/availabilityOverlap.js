// Expand standing-availability weekly patterns into candidate call slots and
// rank them by overlap.
//
// Members are in different timezones, so slots must be compared on a common
// UTC grid: each member's weekly window is expanded in THEIR timezone, then
// every candidate start is converted to a UTC instant before being handed to
// computeBestSlots (which only counts matching slot *strings* — it has no
// timezone awareness of its own). Never emit slot keys in a member's local
// time; two members "free at 14:00" in different zones are free at different
// absolute instants unless converted first.

import { DateTime } from 'luxon';
import { computeBestSlots } from './overlap.js';

// Weekday of a plain calendar date (0=Sun..6=Sat), matching pattern.weekly's
// `day` convention. This is computed from the date's own Y/M/D components
// via the UTC epoch (Date.UTC never applies a local-timezone shift), so it
// is independent of any member's timezone — the calendar date "2026-07-21"
// is a Tuesday everywhere, and the window's date strings are shared across
// all members before any timezone conversion happens.
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// Inclusive date range as an array of 'YYYY-MM-DD' strings.
function eachDateInRange(start, end) {
  const dates = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 10000) {
    dates.push(cur);
    cur = addDaysToDateStr(cur, 1);
    guard += 1;
  }
  return dates;
}

function toUtcSlotKey(dt) {
  const utc = dt.toUTC();
  const y = utc.year;
  const m = String(utc.month).padStart(2, '0');
  const d = String(utc.day).padStart(2, '0');
  const h = String(utc.hour).padStart(2, '0');
  const min = String(utc.minute).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}

// Canonical UTC grid all members' candidate starts are snapped to. Matches
// the client WeeklyPatternGrid's SLOT_MINUTES — the finest start granularity
// the UI allows a member to draw a window boundary at. Stepping every member
// through the SAME absolute grid (rather than each member stepping
// durationMinutes from their own window's start) is what makes offset
// windows and half-hour-offset timezones register overlap — see the
// expandMemberSlots comment below.
const GRID_MINUTES = 30;

// Expands one member's pattern.weekly into duration-aligned UTC slot keys
// across the requested window.
function expandMemberSlots(member, window, durationMinutes) {
  const value = member?.record?.value;
  const weekly = value?.pattern?.weekly;
  const timezone = value?.timezone;
  if (!Array.isArray(weekly) || weekly.length === 0 || !timezone) return [];

  const dates = eachDateInRange(window.start, window.end);
  const slots = [];

  for (const dateStr of dates) {
    const dow = weekdayOf(dateStr);
    const windowsForDay = weekly.filter((w) => w && w.day === dow);
    if (windowsForDay.length === 0) continue;

    const [year, month, day] = dateStr.split('-').map(Number);

    for (const w of windowsForDay) {
      if (typeof w.startTime !== 'string' || typeof w.endTime !== 'string') continue;
      const [startH, startM] = w.startTime.split(':').map(Number);
      const [endH, endM] = w.endTime.split(':').map(Number);

      const startUtc = DateTime.fromObject(
        { year, month, day, hour: startH, minute: startM },
        { zone: timezone }
      ).toUTC();
      const endUtc = DateTime.fromObject(
        { year, month, day, hour: endH, minute: endM },
        { zone: timezone }
      ).toUTC();
      // Defensive: skip only genuinely-invalid constructed times (e.g. a
      // malformed date). NOTE: this does NOT catch DST spring-forward gaps —
      // Luxon resolves a non-existent wall-clock (e.g. 02:30 on a US
      // spring-forward date) to isValid:true using the pre-transition offset,
      // so a window boundary starting inside the ~1h gap converts to a UTC
      // instant off by an hour. Accepted Phase-1 limitation: narrow (only on
      // the transition date, in a DST zone, for a window straddling the
      // gap), and same-zone overlap detection stays sound. A real fix
      // (offset comparison) is a fast-follow.
      if (!startUtc.isValid || !endUtc.isValid) continue;
      const endUtcMs = endUtc.toMillis();
      const durationMs = durationMinutes * 60000;

      // Candidate starts are anchored to the CANONICAL UTC grid (:00/:30),
      // not to this window's own start time. Two members genuinely free
      // together but with offset window boundaries (e.g. A 14:00-16:00 vs
      // B 14:30-16:30) must land on the SAME absolute starts to register
      // overlap in computeBestSlots' exact-string match — stepping each
      // member from their own window start produces disjoint key sets even
      // when a call obviously fits both. Round the window start UP to the
      // next grid boundary first — a +5:45 zone (Asia/Kathmandu) can land
      // startUtc at :15, which isn't a schedulable grid position.
      const remainder = startUtc.minute % GRID_MINUTES;
      let first = remainder === 0 ? startUtc : startUtc.plus({ minutes: GRID_MINUTES - remainder });
      first = first.set({ second: 0, millisecond: 0 });

      for (let c = first; c.toMillis() + durationMs <= endUtcMs; c = c.plus({ minutes: GRID_MINUTES })) {
        slots.push(toUtcSlotKey(c));
      }
    }
  }

  return slots;
}

/**
 * @param {Object} params
 * @param {Array<{did: string, record: {value: {pattern: {weekly: Array}, timezone: string}}}>} params.members
 * @param {{start: string, end: string}} params.window - inclusive 'YYYY-MM-DD' bounds
 * @param {number} params.durationMinutes
 * @returns {Array<{slot: string, participants: string[], count: number}>} sorted by count desc (from computeBestSlots)
 */
export function bestCallSlots({ members, window, durationMinutes }) {
  if (!Array.isArray(members) || !window || !window.start || !window.end) return [];
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return [];

  const responses = members.map((member) => ({
    name: member?.did,
    slots: expandMemberSlots(member, window, durationMinutes),
  }));

  return computeBestSlots(responses);
}
