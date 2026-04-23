import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const OPENMEET_API = process.env.OPENMEET_API_URL || 'https://api.openmeet.net';

// POST /api/openmeet/publish — create an OpenMeet event from a finalized poll
router.post('/publish', requireAuth, async (req, res, next) => {
  try {
    const { title, description, startDate, endDate, timezone, pollUrl } = req.body;

    if (!title || !startDate) {
      return res.status(400).json({ error: 'title and startDate required' });
    }

    // Get OpenMeet auth token via ATProto service auth
    const tokenResult = await getOpenMeetToken(req.oauthSession);
    if (tokenResult.error === 'scope-missing') {
      return res.status(403).json({
        error: 'needs-reauth',
        message: 'Your Bluesky session is missing the OpenMeet permission. Sign out and sign back in to grant it.',
      });
    }
    if (!tokenResult.token) {
      return res.status(502).json({ error: 'Could not authenticate with OpenMeet. Do you have an OpenMeet account linked to your Bluesky?' });
    }
    const token = tokenResult.token;

    const eventPayload = {
      name: title,
      description: description
        ? `${description}\n\nScheduled via Avails: ${pollUrl || ''}`
        : `Scheduled via Avails: ${pollUrl || ''}`,
      startDate,
      endDate: endDate || new Date(new Date(startDate).getTime() + 60 * 60 * 1000).toISOString(),
      type: 'online',
      status: 'published',
      visibility: 'public',
      timeZone: timezone || 'UTC',
      maxAttendees: 0,
      categories: [],
      location: 'Online (scheduled via Avails)',
      locationOnline: pollUrl || undefined,
      source: {
        type: 'bluesky',
        id: req.userDid,
        url: pollUrl || undefined,
        handle: req.userHandle,
      },
    };

    console.log('[openmeet] Creating event:', eventPayload.name);

    const response = await fetch(`${OPENMEET_API}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-tenant-id': process.env.OPENMEET_TENANT_ID || 'lsdfaopkljdfs',
      },
      body: JSON.stringify(eventPayload),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[openmeet] Failed to create event:', response.status, text);
      return res.status(502).json({ error: `OpenMeet API error: ${response.status}` });
    }

    const result = await response.json();
    console.log('[openmeet] Event created:', result.slug || result.id);

    res.json({
      ok: true,
      eventUrl: result.slug
        ? `https://platform.openmeet.net/events/${result.slug}`
        : undefined,
      eventId: result.id,
    });
  } catch (err) {
    next(err);
  }
});

const OPENMEET_DID = 'did:web:api.openmeet.net';

/**
 * Get an OpenMeet bearer token via ATProto service auth.
 * 1. Call user's PDS to get a service auth JWT (signed by their identity)
 * 2. Exchange that JWT for OpenMeet access tokens
 *
 * Returns { token } on success, { error: 'scope-missing' } when the PDS
 * rejects for lack of the OpenMeet RPC scope (grant needs re-consent),
 * or { token: null } for any other failure.
 */
export async function getOpenMeetToken(oauthSession) {
  // Step 1: Get a service auth JWT from the user's PDS
  // com.atproto.server.getServiceAuth returns a JWT scoped for the target service
  const serviceAuthRes = await oauthSession.fetchHandler(
    '/xrpc/com.atproto.server.getServiceAuth?' + new URLSearchParams({
      aud: OPENMEET_DID,
      lxm: 'net.openmeet.auth',
    }),
    { method: 'GET' }
  );

  if (!serviceAuthRes.ok) {
    const text = await serviceAuthRes.text();
    console.log('[openmeet] PDS getServiceAuth failed:', serviceAuthRes.status, text);
    if (serviceAuthRes.status === 403 && text.includes('ScopeMissingError')) {
      return { error: 'scope-missing', token: null };
    }
    return { token: null };
  }

  const { token: pdsJwt } = await serviceAuthRes.json();
  if (!pdsJwt) return { token: null };

  // Step 2: Exchange PDS JWT for OpenMeet tokens
  const exchangeRes = await fetch(`${OPENMEET_API}/api/v1/auth/atproto/service-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': process.env.OPENMEET_TENANT_ID || 'lsdfaopkljdfs',
    },
    body: JSON.stringify({ token: pdsJwt }),
  });

  if (!exchangeRes.ok) {
    const text = await exchangeRes.text();
    console.log('[openmeet] Token exchange failed:', exchangeRes.status, text);
    return { token: null };
  }

  const authData = await exchangeRes.json();
  return { token: authData.token || authData.accessToken || null };
}

// POST /api/openmeet/availability — get calendar events from OpenMeet for authenticated user
router.post('/availability', requireAuth, async (req, res, next) => {
  try {
    const { startTime, endTime } = req.body;

    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime and endTime required' });
    }

    // Get OpenMeet token via ATProto service auth
    const tokenResult = await getOpenMeetToken(req.oauthSession);
    if (tokenResult.error === 'scope-missing') {
      return res.json({ available: false, reason: 'needs-reauth', events: [] });
    }
    if (!tokenResult.token) {
      return res.json({ available: false, reason: 'no-openmeet-account', events: [] });
    }
    const token = tokenResult.token;

    // Fetch calendar events from OpenMeet
    const eventsRes = await fetch(`${OPENMEET_API}/api/external-calendar/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-tenant-id': process.env.OPENMEET_TENANT_ID || 'lsdfaopkljdfs',
      },
      body: JSON.stringify({ startTime, endTime }),
    });

    if (!eventsRes.ok) {
      const text = await eventsRes.text();
      console.log('[openmeet] Calendar events failed:', eventsRes.status, text);
      return res.json({ available: false, reason: 'no-calendar', events: [] });
    }

    const eventsData = await eventsRes.json();
    const events = eventsData.events || eventsData || [];
    console.log('[openmeet] Got', events.length, 'calendar events');

    res.json({
      available: true,
      events: events.map(e => ({
        summary: e.summary || e.title || e.name || 'Busy',
        start: e.start || e.startDate || e.startTime,
        end: e.end || e.endDate || e.endTime,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
