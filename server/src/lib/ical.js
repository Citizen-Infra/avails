import ical from 'ical-generator';

export function generateIcs(poll, pollUrl, participants = []) {
  const calendar = ical({ name: 'Avails' });
  const start = new Date(poll.finalTime);
  const end = new Date(start.getTime() + poll.finalDuration * 60 * 1000);

  const descParts = [];
  if (poll.description) descParts.push(poll.description);
  if (participants.length > 0) descParts.push(`Participants: ${participants.join(', ')}`);
  descParts.push(`Scheduled via Avails: ${pollUrl}`);

  calendar.createEvent({
    start,
    end,
    summary: poll.title,
    description: descParts.join('\n\n'),
    location: pollUrl,
    url: pollUrl,
  });
  return calendar.toString();
}
