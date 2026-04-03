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
  // Include all calendars except known noise (holidays, birthdays)
  const SKIP_PATTERNS = /^(holidays|birthdays|contacts)/i;
  const calendarIds = (calListData.items || [])
    .filter(c => !c.deleted && !SKIP_PATTERNS.test(c.summary || ''))
    .map(c => c.id);

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
        // Only include events that actually block time
        const accepted = data.items.filter(e => {
          if (e.status === 'cancelled') return false;
          // Skip "show as available" events (transparency: transparent)
          if (e.transparency === 'transparent') return false;
          // Skip declined events
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

  const busySlots = new Set();
  // Map slot key → event name (for showing on grid)
  const slotEvents = {};

  for (const event of allEvents) {
    const startStr = event.start?.dateTime;
    const endStr = event.end?.dateTime;
    if (!startStr || !endStr) continue;
    if (event.status === 'cancelled') continue;

    const summary = event.summary || 'Busy';
    const start = new Date(startStr);
    const end = new Date(endStr);
    let current = new Date(start);

    while (current < end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      const hours = String(current.getHours()).padStart(2, '0');
      const mins = String(current.getMinutes()).padStart(2, '0');
      const key = `${year}-${month}-${day}T${hours}:${mins}`;
      busySlots.add(key);
      // Store event name per slot (first event wins if overlap)
      if (!slotEvents[key]) slotEvents[key] = summary;
      current = new Date(current.getTime() + 30 * 60 * 1000);
    }
  }

  return { busySlots, slotEvents };
}
