const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';

export function isGoogleConfigured() {
  return !!GOOGLE_CLIENT_ID;
}

export function requestGoogleAccess() {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services not loaded'));
      return;
    }
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) reject(new Error(response.error));
        else resolve(response.access_token);
      },
    });
    tokenClient.requestAccessToken();
  });
}

/**
 * Fetch events from Google Calendar using the Events list API.
 * Returns a Set of busy slot keys matching the grid format ("YYYY-MM-DDThh:mm")
 * and an array of event objects with { summary, start, end } for display.
 */
export async function fetchBusyTimes(accessToken, dates, timezone) {
  const sortedDates = [...dates].sort();
  const timeMin = new Date(`${sortedDates[0]}T00:00:00`).toISOString();
  const timeMax = new Date(`${sortedDates[sortedDates.length - 1]}T23:59:59`).toISOString();

  // Use Events list API instead of FreeBusy — more reliable and returns event details
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    timeZone: timezone,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });

  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await res.json();
  console.log('[avails] Calendar events response:', data.items?.length, 'events');

  if (data.error) {
    console.error('[avails] Calendar API error:', data.error);
    return new Set();
  }

  const events = data.items || [];
  const busySlots = new Set();

  for (const event of events) {
    // Skip all-day events (they have date, not dateTime)
    const startStr = event.start?.dateTime;
    const endStr = event.end?.dateTime;
    if (!startStr || !endStr) continue;

    // Skip cancelled/declined events
    if (event.status === 'cancelled') continue;

    const start = new Date(startStr);
    const end = new Date(endStr);
    let current = new Date(start);

    while (current < end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      const hours = String(current.getHours()).padStart(2, '0');
      const mins = String(current.getMinutes()).padStart(2, '0');
      busySlots.add(`${year}-${month}-${day}T${hours}:${mins}`);
      current = new Date(current.getTime() + 30 * 60 * 1000);
    }
  }

  console.log('[avails] Busy slots:', [...busySlots]);
  return busySlots;
}
