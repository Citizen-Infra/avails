const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const SCOPE_TYPES = new Set(['atproto-list', 'ca-community']);
const TRUST = new Set(['confirm', 'auto']);
const TIMEZONE_MAX = 64;
const SCOPE_VALUE_MAX = 512;

function validWindow(w) {
  return w && Number.isInteger(w.day) && w.day >= 0 && w.day <= 6 &&
    HHMM.test(w.startTime || '') && HHMM.test(w.endTime || '') && w.startTime < w.endTime;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_TZ =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

// Last calendar day of month `m` (1-12) in year `y`. Date.UTC(y, m, 0) rolls
// back to the final day of the preceding month, which gets leap years right.
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// validUntil must be ISO *and* unambiguous about which instant it names.
//
// `new Date()` alone is far too permissive for a field named ISO: it accepts
// '12/31/2026', 'Dec 31 2026' and even a bare '2026'. Worse, two cases are
// actively wrong rather than merely sloppy:
//
//   - A datetime with no offset ('2026-12-31T00:00:00') is parsed in the
//     host's local zone, so the same request stores a different instant
//     depending on which machine served it. Date-only is fine — the spec
//     reads it as UTC.
//   - Date silently rolls impossible dates over: '2026-02-31' becomes
//     2026-03-03, so a typo would set an expiry three days past anything the
//     caller asked for. The calendar date is therefore checked arithmetically
//     rather than trusted to the parse.
function isValidISODateTime(str) {
  if (typeof str !== 'string') return false;
  const m = ISO_DATE.exec(str) || ISO_DATETIME_TZ.exec(str);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return !Number.isNaN(new Date(str).getTime());
}

export function validateAvailability(body) {
  try {
    const { scope, pattern, timezone, trust, validUntil } = body || {};
    if (!scope || !SCOPE_TYPES.has(scope.type) || typeof scope.value !== 'string' || !scope.value) {
      return { valid: false, error: 'scope must be { type, value }' };
    }
    // Both scope kinds publish. Membership is deliberately NOT verified here,
    // for either kind: a standing offer scoped to a group you are not in is
    // inert, since only that group's scheduler ever reads it — and the same is
    // already true of a Bluesky list, which anyone can name without being on
    // it. Consent to be booked lives in `trust` on the member's own record,
    // not in who is allowed to write one.
    if (!scope.value.trim()) return { valid: false, error: 'scope.value must not be blank' };
    if (scope.value.length > SCOPE_VALUE_MAX) {
      return { valid: false, error: `scope.value must be <= ${SCOPE_VALUE_MAX} chars` };
    }
    if (!pattern || !Array.isArray(pattern.weekly) || pattern.weekly.length === 0) {
      return { valid: false, error: 'pattern.weekly must be a non-empty array' };
    }
    if (!pattern.weekly.every(validWindow)) return { valid: false, error: 'invalid weekly window' };
    if (typeof timezone !== 'string' || !timezone) return { valid: false, error: 'timezone required' };
    if (timezone.length > TIMEZONE_MAX) {
      return { valid: false, error: `timezone must be <= ${TIMEZONE_MAX} chars` };
    }
    if (!TRUST.has(trust)) return { valid: false, error: 'trust must be confirm|auto' };
    if (validUntil !== undefined && !isValidISODateTime(validUntil)) {
      return {
        valid: false,
        error:
          'validUntil must be an ISO date (2026-12-31) or an offset-qualified ISO datetime (2026-12-31T00:00:00Z)',
      };
    }
    const value = {
      scope: { type: scope.type, value: scope.value },
      pattern: { weekly: pattern.weekly.map((w) => ({ day: w.day, startTime: w.startTime, endTime: w.endTime })) },
      timezone,
      trust,
      validUntil: validUntil || new Date(Date.now() + 56 * 24 * 3600 * 1000).toISOString(),
    };
    return { valid: true, value };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}
