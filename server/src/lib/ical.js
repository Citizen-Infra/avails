import ical, { ICalCalendarMethod } from 'ical-generator';

// Deterministic UID lets calendar apps match a subsequent METHOD:CANCEL
// back to the original invite they already imported. Uses poll did/rkey so
// it's stable across republish/unschedule cycles.
export function icsUidFor(did, rkey) {
  const host = new URL(process.env.CLIENT_URL || 'https://avails.local').host;
  return `avails-${did}-${rkey}@${host}`;
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
