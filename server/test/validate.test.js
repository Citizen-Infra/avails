import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateResponseCreate, validatePollCreate, validatePollUpdate, validateGoogleEvent } from '../src/middleware/validate.js';

// Helper: create mock req/res/next for middleware testing
function createMocks(body = {}) {
  const req = { body };
  const res = {
    _status: null,
    _json: null,
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; },
  };
  let called = false;
  const next = () => { called = true; };
  return { req, res, next, nextCalled: () => called };
}

// ── validateResponseCreate ──────────────────────────────────────────────

describe('validateResponseCreate', () => {
  const validBody = {
    name: 'Alice',
    slots: ['2026-04-10T09:00', '2026-04-10T09:30'],
  };

  it('passes valid response with name and slots', () => {
    const { req, res, next, nextCalled } = createMocks(validBody);
    validateResponseCreate(req, res, next);
    assert.ok(nextCalled());
    assert.deepStrictEqual(req.validatedBody, {
      name: 'Alice',
      slots: ['2026-04-10T09:00', '2026-04-10T09:30'],
    });
  });

  it('passes valid response with optional email and did', () => {
    const { req, res, next, nextCalled } = createMocks({
      ...validBody,
      email: 'alice@example.com',
      did: 'did:plc:abc123',
    });
    validateResponseCreate(req, res, next);
    assert.ok(nextCalled());
    assert.deepStrictEqual(req.validatedBody, {
      name: 'Alice',
      email: 'alice@example.com',
      slots: ['2026-04-10T09:00', '2026-04-10T09:30'],
      did: 'did:plc:abc123',
    });
  });

  it('trims name and email', () => {
    const { req, res, next, nextCalled } = createMocks({
      name: '  Alice  ',
      email: '  alice@example.com  ',
      slots: ['2026-04-10T09:00'],
    });
    validateResponseCreate(req, res, next);
    assert.ok(nextCalled());
    assert.equal(req.validatedBody.name, 'Alice');
    assert.equal(req.validatedBody.email, 'alice@example.com');
  });

  it('strips unknown fields (field injection prevention)', () => {
    const { req, res, next, nextCalled } = createMocks({
      ...validBody,
      $type: 'malicious.type',
      pollUri: 'at://hacked',
      createdAt: '2020-01-01',
      admin: true,
    });
    validateResponseCreate(req, res, next);
    assert.ok(nextCalled());
    assert.equal(req.validatedBody.$type, undefined);
    assert.equal(req.validatedBody.pollUri, undefined);
    assert.equal(req.validatedBody.createdAt, undefined);
    assert.equal(req.validatedBody.admin, undefined);
  });

  it('rejects missing name', () => {
    const { req, res, next, nextCalled } = createMocks({ slots: ['2026-04-10T09:00'] });
    validateResponseCreate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
    assert.ok(res._json.error.includes('name is required'));
  });

  it('rejects empty name', () => {
    const { req, res, next, nextCalled } = createMocks({ name: '   ', slots: ['2026-04-10T09:00'] });
    validateResponseCreate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });

  it('rejects missing slots', () => {
    const { req, res, next, nextCalled } = createMocks({ name: 'Alice' });
    validateResponseCreate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
    assert.ok(res._json.error.includes('slots is required'));
  });

  it('rejects empty slots array', () => {
    const { req, res, next, nextCalled } = createMocks({ name: 'Alice', slots: [] });
    validateResponseCreate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });

  it('rejects malformed slot keys', () => {
    const { req, res, next, nextCalled } = createMocks({
      name: 'Alice',
      slots: ['not-a-slot', '2026-04-10T09:00'],
    });
    validateResponseCreate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
    assert.ok(res._json.error.includes('YYYY-MM-DDThh:mm'));
  });

  it('rejects too many slots', () => {
    const slots = Array.from({ length: 501 }, (_, i) =>
      `2026-04-10T${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`
    );
    const { req, res, next, nextCalled } = createMocks({ name: 'Alice', slots });
    validateResponseCreate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
    assert.ok(res._json.error.includes('maximum 500'));
  });

  it('rejects name over 100 characters', () => {
    const { req, res, next, nextCalled } = createMocks({
      name: 'A'.repeat(101),
      slots: ['2026-04-10T09:00'],
    });
    validateResponseCreate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });

  it('rejects completely empty body', () => {
    const { req, res, next, nextCalled } = createMocks({});
    validateResponseCreate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });

  it('rejects undefined body fields (the exact bug scenario)', () => {
    // This is what happened: PUT route had no middleware, so req.validatedBody was undefined
    // Spreading undefined is a no-op, resulting in a record with no name/slots
    const { req, res, next, nextCalled } = createMocks(undefined);
    validateResponseCreate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });
});

// ── validatePollCreate ──────────────────────────────────────────────────

describe('validatePollCreate', () => {
  const validBody = {
    title: 'Team standup',
    dates: ['2026-04-10', '2026-04-11'],
    timeRange: { start: '09:00', end: '17:00' },
    slotMinutes: 30,
    timezone: 'Europe/Berlin',
  };

  it('passes valid poll', () => {
    const { req, res, next, nextCalled } = createMocks(validBody);
    validatePollCreate(req, res, next);
    assert.ok(nextCalled());
    assert.equal(req.validatedBody.title, 'Team standup');
    assert.deepStrictEqual(req.validatedBody.dates, ['2026-04-10', '2026-04-11']);
  });

  it('strips unknown fields', () => {
    const { req, res, next, nextCalled } = createMocks({
      ...validBody,
      finalTime: '2026-04-10T10:00:00Z',
      creatorDid: 'did:plc:hacked',
    });
    validatePollCreate(req, res, next);
    assert.ok(nextCalled());
    assert.equal(req.validatedBody.finalTime, undefined);
    assert.equal(req.validatedBody.creatorDid, undefined);
  });

  it('rejects missing title', () => {
    const { title, ...rest } = validBody;
    const { req, res, next, nextCalled } = createMocks(rest);
    validatePollCreate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });

  it('rejects missing dates', () => {
    const { dates, ...rest } = validBody;
    const { req, res, next, nextCalled } = createMocks(rest);
    validatePollCreate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });

  it('rejects invalid date format', () => {
    const { req, res, next, nextCalled } = createMocks({
      ...validBody,
      dates: ['04/10/2026'],
    });
    validatePollCreate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });

  it('rejects invalid slotMinutes', () => {
    const { req, res, next, nextCalled } = createMocks({
      ...validBody,
      slotMinutes: 45,
    });
    validatePollCreate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });
});

// ── validatePollUpdate ──────────────────────────────────────────────────

describe('validatePollUpdate', () => {
  it('passes with partial update (title only)', () => {
    const { req, res, next, nextCalled } = createMocks({ title: 'New title' });
    validatePollUpdate(req, res, next);
    assert.ok(nextCalled());
    assert.equal(req.validatedBody.title, 'New title');
    assert.equal(req.validatedBody.dates, undefined);
  });

  it('passes with empty body (no-op update)', () => {
    const { req, res, next, nextCalled } = createMocks({});
    validatePollUpdate(req, res, next);
    assert.ok(nextCalled());
    assert.deepStrictEqual(req.validatedBody, {});
  });

  it('strips unknown fields', () => {
    const { req, res, next, nextCalled } = createMocks({
      title: 'Updated',
      finalTime: '2026-04-10T10:00:00Z',
      creatorEmail: 'steal@evil.com',
    });
    validatePollUpdate(req, res, next);
    assert.ok(nextCalled());
    assert.equal(req.validatedBody.finalTime, undefined);
    assert.equal(req.validatedBody.creatorEmail, undefined);
  });

  it('rejects invalid date format in update', () => {
    const { req, res, next, nextCalled } = createMocks({
      dates: ['not-a-date'],
    });
    validatePollUpdate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });

  it('accepts community to link an existing poll', () => {
    const { req, res, next, nextCalled } = createMocks({ community: 'cibc' });
    validatePollUpdate(req, res, next);
    assert.ok(nextCalled());
    assert.equal(req.validatedBody.community, 'cibc');
  });

  it('accepts empty community to unlink', () => {
    const { req, res, next, nextCalled } = createMocks({ community: '' });
    validatePollUpdate(req, res, next);
    assert.ok(nextCalled());
    assert.equal(req.validatedBody.community, '');
  });

  it('rejects a non-string community', () => {
    const { req, res, next, nextCalled } = createMocks({ community: 123 });
    validatePollUpdate(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });
});

// ── validateGoogleEvent ─────────────────────────────────────────────────

describe('validateGoogleEvent', () => {
  const validBody = {
    googleEventId: 'abc123xyz',
    googleCalendarId: 'sensemakingscenius@gmail.com',
  };

  it('passes valid body', () => {
    const { req, res, next, nextCalled } = createMocks(validBody);
    validateGoogleEvent(req, res, next);
    assert.ok(nextCalled());
    assert.deepStrictEqual(req.validatedBody, validBody);
  });

  it('strips unknown fields (field injection prevention)', () => {
    const { req, res, next, nextCalled } = createMocks({
      ...validBody,
      finalTime: '2026-04-10T10:00:00Z',
      status: 'open',
      creatorDid: 'did:plc:hacked',
    });
    validateGoogleEvent(req, res, next);
    assert.ok(nextCalled());
    assert.deepStrictEqual(req.validatedBody, validBody);
    assert.equal(req.validatedBody.finalTime, undefined);
    assert.equal(req.validatedBody.status, undefined);
    assert.equal(req.validatedBody.creatorDid, undefined);
  });

  it('rejects missing googleEventId', () => {
    const { req, res, next, nextCalled } = createMocks({ googleCalendarId: 'cal@example.com' });
    validateGoogleEvent(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
    assert.ok(res._json.error.includes('googleEventId'));
  });

  it('rejects missing googleCalendarId', () => {
    const { req, res, next, nextCalled } = createMocks({ googleEventId: 'abc' });
    validateGoogleEvent(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
    assert.ok(res._json.error.includes('googleCalendarId'));
  });

  it('rejects empty strings', () => {
    const { req, res, next, nextCalled } = createMocks({ googleEventId: '', googleCalendarId: '' });
    validateGoogleEvent(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });

  it('rejects non-string types', () => {
    const { req, res, next, nextCalled } = createMocks({ googleEventId: 123, googleCalendarId: true });
    validateGoogleEvent(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });

  it('rejects oversize fields', () => {
    const { req, res, next, nextCalled } = createMocks({
      googleEventId: 'a'.repeat(257),
      googleCalendarId: 'b'.repeat(257),
    });
    validateGoogleEvent(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });

  it('rejects completely empty body', () => {
    const { req, res, next, nextCalled } = createMocks({});
    validateGoogleEvent(req, res, next);
    assert.ok(!nextCalled());
    assert.equal(res._status, 400);
  });
});
