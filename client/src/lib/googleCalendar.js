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

  // First get all calendars the user has access to
  const calListRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const calListData = await calListRes.json();
  const calendarIds = (calListData.items || [])
    .filter(c => c.accessRole === 'owner' || c.accessRole === 'reader' || c.accessRole === 'writer')
    .map(c => c.id);

  console.log('[avails] Found', calendarIds.length, 'calendars');

  // Fetch events from all calendars
  const allEvents = [];
  for (const calId of calendarIds) {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      timeZone: timezone,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '100',
    });

    try {
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data.items) {
        // Only include events the user has accepted or not responded to (not declined)
        const accepted = data.items.filter(e => {
          if (e.status === 'cancelled') return false;
          const self = e.attendees?.find(a => a.self);
          if (self && self.responseStatus === 'declined') return false;
          return true;
        });
        allEvents.push(...accepted);
      }
    } catch (err) {
      console.warn('[avails] Failed to fetch calendar', calId, err.message);
    }
  }

  console.log('[avails] Total events across all calendars:', allEvents.length);

  const events = allEvents;
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
