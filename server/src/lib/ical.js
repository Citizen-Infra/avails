import ical from 'ical-generator';

export function generateIcs(poll, pollUrl) {
  const calendar = ical({ name: 'Avails' });
  const start = new Date(poll.finalTime);
  const end = new Date(start.getTime() + poll.finalDuration * 60 * 1000);
  calendar.createEvent({
    start,
    end,
    summary: poll.title,
    description: poll.description
      ? `${poll.description}\n\nScheduled via Avails: ${pollUrl}`
      : `Scheduled via Avails: ${pollUrl}`,
    url: pollUrl,
    timezone: poll.timezone,
  });
  return calendar.toString();
}
