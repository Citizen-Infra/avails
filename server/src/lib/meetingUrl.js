// Validation for the meeting link attached to a scheduled poll (#19).
//
// This value is more dangerous than it looks. It is supplied by a user, stored
// in a world-readable PDS record, rendered as an href in the finalized banner,
// and written into an .ics that lands in participants' calendar apps. Three
// separate consumers, each with its own way to be hurt by a hostile string, so
// the check belongs here once rather than at each of them.
//
//   - `javascript:` and `data:` URLs parse perfectly well as URLs and would
//     become a working XSS the moment the banner renders one as a link. The
//     scheme allowlist is the whole defence; there is no sanitiser downstream.
//   - iCalendar is a line-oriented format built on CRLF, so a newline in a
//     property value is a content-injection primitive. ical-generator escapes
//     correctly today, but the rejection is cheap and does not depend on that
//     staying true.
//
// Order matters below: the CRLF check runs BEFORE parsing, because WHATWG URL
// silently strips tabs and newlines. Parsing first would launder a hostile
// string into a clean-looking one and report success.

const MAX_LENGTH = 500;

/**
 * Normalize a caller-supplied meeting link.
 *
 * @param {unknown} value
 * @returns {string|null} the trimmed URL, or null for absence — an empty
 *   string is how a caller CLEARS the link, so it is valid input, not an error.
 * @throws {Error} with a message safe to show a user
 */
export function normalizeMeetingUrl(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('meetingUrl must be a string');

  const trimmed = value.trim();
  if (trimmed === '') return null;

  if (trimmed.length > MAX_LENGTH) {
    throw new Error(`meetingUrl must be under ${MAX_LENGTH} characters`);
  }
  // Before parsing. See the note above on URL stripping these.
  if (/[\r\n\t]/.test(trimmed)) {
    throw new Error('meetingUrl must not contain line breaks');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('meetingUrl must be a valid URL, including https://');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('meetingUrl must be an http or https URL');
  }

  // The original, not parsed.href: href normalizes (appends a trailing slash to
  // a bare origin, re-encodes) and a meeting link should read back exactly as
  // the person pasted it.
  return trimmed;
}
