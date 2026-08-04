import ical, { ICalCalendarMethod } from 'ical-generator';

// The right-hand side of the UID. A FROZEN NAMESPACE, NOT A DEPLOYMENT HOST.
//
// Do not update this when avails moves hosts. Every event already invited
// carries the old value, and a METHOD:CANCEL only removes an event from
// someone's calendar if its UID matches the REQUEST they already imported —
// so changing it silently orphans every outstanding invite. Nothing errors;
// cancellations just stop working.
//
// This used to be derived from CLIENT_URL, which meant the 2026-08-04 move
// from avails.zhgnv.com did exactly that. It was harmless only because every
// event invited under the old host had already happened. Frozen at that moment
// precisely because the exposure was zero.
//
// RFC 5545 §3.8.4.7 recommends the right-hand side carry "some domain
// identifier (either of the host itself **or otherwise**)" — "or otherwise" is
// what makes a fixed namespace the intended shape rather than a workaround.
// Uniqueness does not rest on it in any case: the left-hand side carries a
// DID, which is globally unique by construction.
const UID_NAMESPACE = 'avails.citizeninfra.org';

// Deterministic UID lets calendar apps match a subsequent METHOD:CANCEL
// back to the original invite they already imported. Uses poll did/rkey so
// it's stable across republish/unschedule cycles — and no environment input,
// so it's stable across redeploys and host moves too.
export function icsUidFor(did, rkey) {
  return `avails-${did}-${rkey}@${UID_NAMESPACE}`;
}

/**
 * @param {object} opts
 * @param {object} opts.poll     The poll record (needs title, finalTime, finalDuration, optional description)
 * @param {string} opts.pollUrl  Link back to the poll
 * @param {string} opts.did      Poll creator's DID (for deterministic UID)
 * @param {string} opts.rkey     Poll record key (for deterministic UID)
 * @param {string[]} [opts.participants]  Names to surface in the description
 * @param {'REQUEST'|'CANCEL'} [opts.method]  REQUEST for new invites, CANCEL to remove from participant calendars
 */
export function generateIcs({ poll, pollUrl, did, rkey, participants = [], method = 'REQUEST' }) {
  const calendar = ical({ name: 'Avails' });
  calendar.method(method === 'CANCEL' ? ICalCalendarMethod.CANCEL : ICalCalendarMethod.REQUEST);

  const start = new Date(poll.finalTime);
  const end = new Date(start.getTime() + poll.finalDuration * 60 * 1000);

  const descParts = [];
  if (poll.description) descParts.push(poll.description);
  if (participants.length > 0) descParts.push(`Participants: ${participants.join(', ')}`);
  descParts.push(
    method === 'CANCEL'
      ? `This meeting has been cancelled.\nOriginal poll: ${pollUrl}`
      : `Scheduled via Avails: ${pollUrl}`
  );

  calendar.createEvent({
    id: icsUidFor(did, rkey),
    start,
    end,
    summary: method === 'CANCEL' ? `Cancelled: ${poll.title}` : poll.title,
    description: descParts.join('\n\n'),
    url: pollUrl,
    status: method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED',
  });
  return calendar.toString();
}
