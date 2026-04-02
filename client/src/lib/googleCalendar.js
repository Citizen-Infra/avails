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

export async function fetchBusyTimes(accessToken, dates, timezone) {
  const sortedDates = [...dates].sort();
  const timeMin = new Date(`${sortedDates[0]}T00:00:00`).toISOString();
  const timeMax = new Date(`${sortedDates[sortedDates.length - 1]}T23:59:59`).toISOString();

  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin, timeMax,
      timeZone: timezone,
      items: [{ id: 'primary' }],
    }),
  });

  const data = await res.json();
  const busyPeriods = data.calendars?.primary?.busy || [];
  const busySlots = new Set();

  for (const period of busyPeriods) {
    let current = new Date(period.start);
    const end = new Date(period.end);
    while (current < end) {
      const date = current.toISOString().split('T')[0];
      const hours = String(current.getHours()).padStart(2, '0');
      const mins = String(current.getMinutes()).padStart(2, '0');
      busySlots.add(`${date}T${hours}:${mins}`);
      current = new Date(current.getTime() + 30 * 60 * 1000);
    }
  }
  return busySlots;
}
