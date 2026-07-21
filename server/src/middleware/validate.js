/**
 * Input validation for poll and response creation/update.
 * Whitelist allowed fields, validate types and ranges.
 */

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}$/;
const SLOT_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function validatePollCreate(req, res, next) {
  const { title, description, dates, timeRange, slotMinutes, timezone, community, notifyAfter, notifyVia, notifyEmail, hideResponsesUntilSubmit } = req.body;

  const errors = [];

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    errors.push('title is required');
  } else if (title.length > 200) {
    errors.push('title must be under 200 characters');
  }

  if (description !== undefined && typeof description !== 'string') {
    errors.push('description must be a string');
  } else if (description && description.length > 1000) {
    errors.push('description must be under 1000 characters');
  }

  if (!dates || !Array.isArray(dates) || dates.length === 0) {
    errors.push('dates is required (array of YYYY-MM-DD)');
  } else if (dates.length > 31) {
    errors.push('maximum 31 dates');
  } else if (!dates.every(d => typeof d === 'string' && DATE_REGEX.test(d))) {
    errors.push('dates must be YYYY-MM-DD strings');
  }

  if (!timeRange || typeof timeRange !== 'object' || !timeRange.start || !timeRange.end) {
    errors.push('timeRange with start and end is required');
  } else {
    if (!TIME_REGEX.test(timeRange.start)) errors.push('timeRange.start must be HH:MM');
    if (!TIME_REGEX.test(timeRange.end)) errors.push('timeRange.end must be HH:MM');
  }

  if (!slotMinutes || ![15, 30, 60].includes(slotMinutes)) {
    errors.push('slotMinutes must be 15, 30, or 60');
  }

  if (!timezone || typeof timezone !== 'string') {
    errors.push('timezone is required');
  } else if (timezone.length > 100) {
    errors.push('timezone must be under 100 characters');
  }

  if (community !== undefined && typeof community !== 'string') {
    errors.push('community must be a string');
  }

  if (notifyAfter !== undefined && (typeof notifyAfter !== 'number' || notifyAfter < 1)) {
    errors.push('notifyAfter must be a positive integer');
  }

  if (notifyVia !== undefined && !['email', 'telegram'].includes(notifyVia)) {
    errors.push('notifyVia must be email or telegram');
  }

  if (notifyEmail !== undefined && typeof notifyEmail !== 'string') {
    errors.push('notifyEmail must be a string');
  }

  if (hideResponsesUntilSubmit !== undefined && typeof hideResponsesUntilSubmit !== 'boolean') {
    errors.push('hideResponsesUntilSubmit must be a boolean');
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  // Whitelist: only allow known fields through
  req.validatedBody = {
    title: title.trim(),
    ...(description && { description: description.trim() }),
    dates,
    timeRange,
    slotMinutes,
    timezone,
    ...(community && { community }),
    ...(notifyAfter && { notifyAfter }),
    ...(notifyVia && { notifyVia }),
    ...(notifyEmail && { notifyEmail: notifyEmail.trim() }),
    ...(hideResponsesUntilSubmit === true && { hideResponsesUntilSubmit: true }),
  };

  next();
}

export function validateResponseCreate(req, res, next) {
  const { name, email, slots, did } = req.body;

  const errors = [];

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('name is required');
  } else if (name.length > 100) {
    errors.push('name must be under 100 characters');
  }

  if (email !== undefined && typeof email !== 'string') {
    errors.push('email must be a string');
  } else if (email && email.length > 200) {
    errors.push('email must be under 200 characters');
  }

  if (!slots || !Array.isArray(slots) || slots.length === 0) {
    errors.push('slots is required (array of YYYY-MM-DDThh:mm)');
  } else if (!slots.every(s => typeof s === 'string' && SLOT_REGEX.test(s))) {
    errors.push('slots must be YYYY-MM-DDThh:mm strings');
  } else if (slots.length > 500) {
    errors.push('maximum 500 slots');
  }

  if (did !== undefined && typeof did !== 'string') {
    errors.push('did must be a string');
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  req.validatedBody = {
    name: name.trim(),
    ...(email && { email: email.trim() }),
    slots,
    ...(did && { did }),
  };

  next();
}

export function validatePollUpdate(req, res, next) {
  const { title, description, dates, timeRange, slotMinutes, hideResponsesUntilSubmit, community } = req.body;

  const errors = [];

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0) {
      errors.push('title must be a non-empty string');
    } else if (title.length > 200) {
      errors.push('title must be under 200 characters');
    }
  }

  if (description !== undefined && typeof description !== 'string') {
    errors.push('description must be a string');
  }

  if (dates !== undefined) {
    if (!Array.isArray(dates) || dates.length === 0) {
      errors.push('dates must be a non-empty array');
    } else if (!dates.every(d => typeof d === 'string' && DATE_REGEX.test(d))) {
      errors.push('dates must be YYYY-MM-DD strings');
    }
  }

  if (timeRange !== undefined) {
    if (!timeRange.start || !timeRange.end) {
      errors.push('timeRange must have start and end');
    } else {
      if (!TIME_REGEX.test(timeRange.start)) errors.push('timeRange.start must be HH:MM');
      if (!TIME_REGEX.test(timeRange.end)) errors.push('timeRange.end must be HH:MM');
    }
  }

  if (slotMinutes !== undefined && ![15, 30, 60].includes(slotMinutes)) {
    errors.push('slotMinutes must be 15, 30, or 60');
  }

  if (hideResponsesUntilSubmit !== undefined && typeof hideResponsesUntilSubmit !== 'boolean') {
    errors.push('hideResponsesUntilSubmit must be a boolean');
  }

  // community is the group a poll belongs to. Allowed on update so an existing
  // poll can be linked/relinked (empty string unlinks). String type, same as create.
  if (community !== undefined && typeof community !== 'string') {
    errors.push('community must be a string');
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  // Whitelist
  req.validatedBody = {};
  if (title !== undefined) req.validatedBody.title = title.trim();
  if (description !== undefined) req.validatedBody.description = description.trim();
  if (dates !== undefined) req.validatedBody.dates = dates;
  if (timeRange !== undefined) req.validatedBody.timeRange = timeRange;
  if (slotMinutes !== undefined) req.validatedBody.slotMinutes = slotMinutes;
  if (hideResponsesUntilSubmit !== undefined) req.validatedBody.hideResponsesUntilSubmit = hideResponsesUntilSubmit;
  if (community !== undefined) req.validatedBody.community = community;

  next();
}

export function validateGoogleEvent(req, res, next) {
  const { googleEventId, googleCalendarId } = req.body;

  const errors = [];
  if (typeof googleEventId !== 'string' || googleEventId.length === 0) {
    errors.push('googleEventId must be a non-empty string');
  } else if (googleEventId.length > 256) {
    errors.push('googleEventId must be under 256 characters');
  }
  if (typeof googleCalendarId !== 'string' || googleCalendarId.length === 0) {
    errors.push('googleCalendarId must be a non-empty string');
  } else if (googleCalendarId.length > 256) {
    errors.push('googleCalendarId must be under 256 characters');
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  req.validatedBody = { googleEventId, googleCalendarId };
  next();
}
