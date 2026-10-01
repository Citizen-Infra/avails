import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { secretMatches, bearerFrom } from '../lib/bearerAuth.js';
import { callBookingStore, callBookingResult, callParticipantView } from '../lib/callBookings.js';
import { generateIcs } from '../lib/ical.js';

const router = express.Router();
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

// CA's credential grants access only to bookings made by that service grant,
// not to the bookings an individual list owner made with their own identity.
router.get('/:id/handoff', async (req, res, next) => {
  try {
    if (!secretMatches(bearerFrom(req), process.env.AVAILS_SERVICE_SECRET)) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const booking = await callBookingStore.get(req.params.id);
    if (booking.caller !== 'service') return res.status(404).json({ error: 'Call not found' });
    res.json(callBookingResult(booking));
  } catch (err) { next(err); }
});

router.use(requireAuth);

router.get('/:id', async (req, res, next) => {
  try {
    res.json(callParticipantView(await callBookingStore.get(req.params.id), req.userDid));
  } catch (err) { next(err); }
});

export function validateCallDecision(req, res, next) {
  const body = req.body;
  if (!body || !['accept', 'decline'].includes(body.decision)
    || Object.keys(body).some((key) => key !== 'decision')) {
    return res.status(400).json({ error: 'Only decision: accept or decline is allowed' });
  }
  // Same-origin cookie-authenticated UI; CORS is not a CSRF boundary.
  if (req.get('origin') && req.get('origin') !== new URL(
    process.env.CLIENT_URL || 'http://localhost:5173',
  ).origin) return res.status(403).json({ error: 'Invalid request origin' });
  req.validatedBody = { decision: body.decision };
  next();
}

router.post('/:id/decision', validateCallDecision, async (req, res, next) => {
  try {
    const booking = await callBookingStore.decide(req.params.id, req.userDid, req.validatedBody.decision);
    res.json(callParticipantView(booking, req.userDid));
  } catch (err) { next(err); }
});

router.get('/:id/calendar.ics', async (req, res, next) => {
  try {
    const booking = await callBookingStore.get(req.params.id);
    const own = callParticipantView(booking, req.userDid);
    if (!own.canDownload) return res.status(403).json({ error: 'Confirm this time before downloading it' });
    // Deliberately no roster in the calendar artifact, even for confirmed users.
    const ics = generateIcs({
      poll: { title: booking.title, finalTime: `${booking.slot}:00Z`, finalDuration: booking.durationMinutes },
      pollUrl: callBookingResult(booking).bookingUrl,
      did: 'did:avails:call', rkey: booking.id,
    });
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="avails-call.ics"');
    res.send(ics);
  } catch (err) { next(err); }
});

export default router;
