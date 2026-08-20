const CAPABILITY = 'publish-standing-availability';
const INACTIVE_REASONS = new Set(['not-following', 'blocking', 'blocked-by', 'excluded']);

export class EventGrantError extends Error {
  constructor(message, { status = 503, reason, retryable = false } = {}) {
    super(message);
    this.name = 'EventGrantError';
    this.status = status;
    this.reason = reason;
    this.retryable = retryable;
  }
}

function fetchWithTimeout(url, options, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

// Community Admin is the sole event-grant authority. This decision is fetched
// for every write and deliberately is not cached or replaced with an ATProto
// graph lookup when Community Admin is unavailable.
export async function assertEventAvailabilityGrant(eventDid, subjectDid) {
  const baseUrl = process.env.CA_MEMBERSHIP_URL?.replace(/\/$/, '');
  const secret = process.env.CA_CONFIG_SECRET;
  if (!baseUrl || !secret) {
    throw new EventGrantError('Event authorization is not configured. Try again later.', {
      retryable: true,
    });
  }

  let response;
  try {
    response = await fetchWithTimeout(
      `${baseUrl}/internal/event-participant-grants/introspect`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_did: eventDid,
          subject_did: subjectDid,
          capability: CAPABILITY,
        }),
      }
    );
  } catch {
    throw new EventGrantError('Event authorization is temporarily unavailable. Try again later.', {
      retryable: true,
    });
  }

  if (!response.ok) {
    throw new EventGrantError('Event authorization is temporarily unavailable. Try again later.', {
      retryable: true,
    });
  }

  let decision;
  try {
    decision = await response.json();
  } catch {
    throw new EventGrantError('Event authorization returned an invalid response. Try again later.', {
      retryable: true,
    });
  }

  const validDecision =
    decision?.relationship === 'event-participant' &&
    decision.event_did === eventDid &&
    decision.subject_did === subjectDid &&
    decision.capability === CAPABILITY &&
    typeof decision.active === 'boolean' &&
    (decision.active ? decision.reason === 'active' : INACTIVE_REASONS.has(decision.reason));
  if (!validDecision) {
    throw new EventGrantError('Event authorization returned an invalid response. Try again later.', {
      retryable: true,
    });
  }

  if (!decision.active) {
    throw new EventGrantError('You do not have an active grant to publish availability for this event.', {
      status: 403,
      reason: decision.reason,
    });
  }

  return decision;
}
