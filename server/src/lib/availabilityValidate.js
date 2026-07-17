const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const SCOPE_TYPES = new Set(['atproto-list', 'ca-community']);
const TRUST = new Set(['confirm', 'auto']);

function validWindow(w) {
  return w && Number.isInteger(w.day) && w.day >= 0 && w.day <= 6 &&
    HHMM.test(w.startTime || '') && HHMM.test(w.endTime || '') && w.startTime < w.endTime;
}

export function validateAvailability(body) {
  try {
    const { scope, pattern, timezone, trust, validUntil } = body || {};
    if (!scope || !SCOPE_TYPES.has(scope.type) || typeof scope.value !== 'string' || !scope.value) {
      return { valid: false, error: 'scope must be { type, value }' };
    }
    // Phase 1 only publishes atproto-list scope.
    if (scope.type !== 'atproto-list') return { valid: false, error: 'Phase 1 supports atproto-list scope only' };
    if (!pattern || !Array.isArray(pattern.weekly) || pattern.weekly.length === 0) {
      return { valid: false, error: 'pattern.weekly must be a non-empty array' };
    }
    if (!pattern.weekly.every(validWindow)) return { valid: false, error: 'invalid weekly window' };
    if (typeof timezone !== 'string' || !timezone) return { valid: false, error: 'timezone required' };
    if (!TRUST.has(trust)) return { valid: false, error: 'trust must be confirm|auto' };
    const now = new Date().toISOString();
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
