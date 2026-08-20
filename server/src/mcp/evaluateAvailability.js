import { resolveAvailabilityForDids } from './listMembers.js';
import { bestCallSlots } from './availabilityOverlap.js';
import { assertResolvableScope, isDid, normalizeScope } from './scope.js';

function assertDateWindow(window) {
  if (!window || !/^\d{4}-\d{2}-\d{2}$/.test(window.start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(window.end || '')) {
    throw new Error('window.start and window.end must be YYYY-MM-DD dates');
  }
  if (window.end < window.start) throw new Error('window.end must not be before window.start');
}

// Read-only by construction: this module imports only public availability reads
// and overlap calculation. It has no access to booking, email, ICS, or polls.
export async function evaluateAvailabilityOverlap(
  { scope, eligibleDids, window, durationMinutes, threshold },
  authContext
) {
  if (authContext?.service !== 'community-admin') {
    throw new Error('evaluate_availability_overlap requires an authorized service');
  }

  const normalizedScope = normalizeScope(scope);
  if (normalizedScope.type !== 'ca-event') {
    throw new Error('evaluate_availability_overlap requires a ca-event scope');
  }
  assertResolvableScope(normalizedScope);

  if (!Array.isArray(eligibleDids) || eligibleDids.length === 0 || !eligibleDids.every(isDid)) {
    throw new Error('eligibleDids must be a non-empty array of DIDs');
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error('durationMinutes must be a positive integer');
  }
  if (!Number.isInteger(threshold) || threshold < 3) {
    throw new Error('threshold must be an integer of at least 3');
  }
  assertDateWindow(window);

  const uniqueDids = [...new Set(eligibleDids)];
  const members = await resolveAvailabilityForDids(uniqueDids, normalizedScope);
  const slots = bestCallSlots({ members, window, durationMinutes });
  const top = slots[0];
  const maxOverlap = top?.count || 0;

  return {
    ready: maxOverlap >= threshold,
    threshold,
    eligibleSupporters: uniqueDids.length,
    supportersWithRecords: members.length,
    maxOverlap,
    candidateSlot: top?.slot || null,
  };
}
