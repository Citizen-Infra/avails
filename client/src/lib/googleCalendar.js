const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES_READONLY = 'https://www.googleapis.com/auth/calendar.readonly';
const SCOPES_EVENTS = 'https://www.googleapis.com/auth/calendar.events';

export function isGoogleConfigured() {
  return !!GOOGLE_CLIENT_ID;
}

export function requestGoogleAccess(scope = SCOPES_READONLY) {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services not loaded'));
      return;
    }
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope,
      callback: (response) => {
        if (response.error) reject(new Error(response.error));
        else resolve(response.access_token);
      },
    });
    tokenClient.requestAccessToken();
  });
}

export const GOOGLE_SCOPES = { READONLY: SCOPES_READONLY, EVENTS: SCOPES_EVENTS };

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

/**
 * Fetch the user's calendar list and return only those they can write events to.
 * Filters by accessRole === 'owner' | 'writer'. Excludes hidden/deleted entries.
 * Returns: [{ id, summary, accessRole, primary }]
 */
export async function listWritableCalendars(accessToken) {
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`calendarList failed: ${res.status}`);
  }
  const data = await res.json();
  return (data.items || [])
    .filter(c => !c.deleted && !c.hidden)
    .filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
    .map(c => ({
      id: c.id,
      summary: c.summary || c.id,
      accessRole: c.accessRole,
      primary: !!c.primary,
    }));
}

/**
 * Insert a single event into a Google Calendar.
 * eventBody must conform to https://developers.google.com/calendar/api/v3/reference/events#resource
 * Returns the created event resource (so callers can use { htmlLink, id }).
 */
export async function insertEvent(accessToken, calendarId, eventBody) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`insertEvent failed: ${res.status} ${text}`);
  }
  return res.json();
}
