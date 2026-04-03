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

    // Step 1: Get OpenMeet auth token via ATProto service auth
    // The creator's ATProto OAuth session can sign a service auth JWT
    // For now, use the integration endpoint which may accept Bluesky source without auth
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
      source: {
        type: 'bluesky',
        id: req.userDid,
        url: pollUrl || undefined,
        handle: req.userHandle,
      },
      location: {
        description: 'Online (scheduled via Avails)',
        url: pollUrl || undefined,
      },
    };

    console.log('[openmeet] Creating event:', eventPayload.name);

    const response = await fetch(`${OPENMEET_API}/api/integration/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': process.env.OPENMEET_TENANT_ID || '1',
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

export default router;
