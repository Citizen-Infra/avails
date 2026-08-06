/**
 * PUT /api/polls/:did/:rkey/meeting-link (#19).
 *
 * Changing the link on an already-scheduled poll has to re-issue the calendar
 * invite, because a calendar entry is exactly where the link needs to land and
 * an email carrying an .ics is the only channel to it. That makes this route's
 * side effect everyone's inbox, so the tests here are mostly about when it must
 * NOT fire: no change, no write, no mail.
 *
 * Deliberately not a second call to /finalize. That would work mechanically —
 * the frozen UID (#167) means calendars update in place — but would mail
 * everyone an announcement of a scheduling they already received.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';

const POLL_COLLECTION = 'chat.avails.scheduling.poll';
const did = 'did:plc:creator';
const rkey = 'poll1';

const mockSessions = new Map();
mock.module('../src/lib/sessionStore.js', {
  namedExports: {
    sessions: mockSessions,
    getSession: (id) => mockSessions.get(id),
    createSession: () => 'mock-session-id',
    deleteSession: () => {},
    cleanupExpiredSessions: () => {},
    getOAuthSession: () => null,
  },
});

let sentEmails = [];
mock.module('../src/lib/email.js', {
  namedExports: {
    sendEmail: async (opts) => {
      sentEmails.push(opts);
      return { id: 'mock-email' };
    },
  },
});

// The poll record the PDS will hand back, per test.
let pollRecord;
// Responses fetchPollResponses will see.
let responseRecords;
let xrpcCalls = [];

const mockFetchHandler = async (pathname, opts) => {
  xrpcCalls.push({ method: pathname.replace('/xrpc/', ''), body: JSON.parse(opts.body) });
  return { ok: true, json: async () => ({ cid: 'cid-updated' }), text: async () => 'ok' };
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('plc.directory')) {
    return {
      ok: true,
      json: async () => ({
        service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://mock-pds.test' }],
      }),
    };
  }
  if (u.includes('getRecord')) {
    if (!pollRecord) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => ({ value: pollRecord, cid: 'cid-existing' }) };
  }
  if (u.includes('listRecords')) {
    return { ok: true, json: async () => ({ records: responseRecords }) };
  }
  return originalFetch(url, opts);
};

const { default: pollRoutes } = await import('../src/routes/polls.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/polls', pollRoutes);
  return app;
}

async function request(app, body, cookie = 'avails_session=creator-session') {
  const { once } = await import('node:events');
  const server = app.listen(0);
  await once(server, 'listening');
  const port = server.address().port;
  try {
    const res = await originalFetch(`http://localhost:${port}/api/polls/${did}/${rkey}/meeting-link`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

// pagedResponses keeps only records whose pollUri ends with this poll's rkey,
// so a fixture without one is silently dropped and the route looks like it
// mailed nobody.
let responseSeq = 0;
function response(name, email) {
  responseSeq += 1;
  return {
    uri: `at://${did}/chat.avails.scheduling.response/r${responseSeq}`,
    cid: `cid-r${responseSeq}`,
    value: {
      name,
      ...(email ? { email } : {}),
      pollUri: `at://${did}/${POLL_COLLECTION}/${rkey}`,
      slots: [],
    },
  };
}

function scheduledPoll(extra = {}) {
  return {
    title: 'Weekly sync',
    finalTime: '2026-08-11T14:00:00.000Z',
    finalDuration: 60,
    timezone: 'UTC',
    status: 'finalized',
    ...extra,
  };
}

describe('PUT /api/polls/:did/:rkey/meeting-link', () => {
  beforeEach(() => {
    xrpcCalls = [];
    sentEmails = [];
    pollRecord = scheduledPoll();
    responseRecords = [response('Alice', 'alice@example.test'), response('Bob', 'bob@example.test')];
    mockSessions.set('creator-session', {
      did,
      handle: 'creator.test',
      oauthSession: { fetchHandler: mockFetchHandler },
    });
    mockSessions.set('stranger-session', {
      did: 'did:plc:someoneelse',
      handle: 'nosy.test',
      oauthSession: { fetchHandler: mockFetchHandler },
    });
  });

  it('sets a link, writes it, and re-issues the invite to everyone who answered', async () => {
    const res = await request(createApp(), { meetingUrl: 'https://meet.jit.si/avails-poll1' });

    assert.equal(res.status, 200);
    assert.equal(res.body.changed, true);
    assert.equal(res.body.notified, 2);

    const write = xrpcCalls.find((c) => c.method === 'com.atproto.repo.putRecord');
    assert.ok(write, 'wrote the record');
    assert.equal(write.body.collection, POLL_COLLECTION);
    assert.equal(write.body.record.meetingUrl, 'https://meet.jit.si/avails-poll1');
    // The schedule itself must survive untouched — this route changes one field.
    assert.equal(write.body.record.finalTime, '2026-08-11T14:00:00.000Z');
    assert.equal(write.body.swapRecord, 'cid-existing');

    assert.equal(sentEmails.length, 2);
    const ics = Buffer.from(sentEmails[0].attachments[0].content, 'base64').toString();
    // Same UID as the original REQUEST, so calendars replace rather than add.
    assert.match(ics, new RegExp(`UID:avails-${did}-${rkey}@`));
    assert.match(ics, /METHOD:REQUEST/);
    assert.match(ics, /LOCATION:https:\/\/meet\.jit\.si\/avails-poll1/);
  });

  it('says the time has not changed, so this cannot read as a reschedule', async () => {
    await request(createApp(), { meetingUrl: 'https://meet.jit.si/avails-poll1' });
    const mail = sentEmails[0];
    assert.match(mail.subject, /meeting link/i);
    assert.doesNotMatch(mail.subject, /time confirmed/i);
    const text = JSON.stringify(mail);
    assert.match(text, /time has not changed/i);
  });

  it('an unchanged value writes nothing and mails nobody', async () => {
    // The failure this guards is everyone's inbox, every time someone opens the
    // field and closes it again without editing.
    pollRecord = scheduledPoll({ meetingUrl: 'https://meet.jit.si/avails-poll1' });
    const res = await request(createApp(), { meetingUrl: 'https://meet.jit.si/avails-poll1' });

    assert.equal(res.status, 200);
    assert.equal(res.body.changed, false);
    assert.deepEqual(xrpcCalls, []);
    assert.deepEqual(sentEmails, []);
  });

  it('an empty string removes the link and says so', async () => {
    pollRecord = scheduledPoll({ meetingUrl: 'https://meet.jit.si/avails-poll1' });
    const res = await request(createApp(), { meetingUrl: '' });

    assert.equal(res.status, 200);
    assert.equal(res.body.changed, true);
    assert.equal(res.body.meetingUrl, null);

    const write = xrpcCalls.find((c) => c.method === 'com.atproto.repo.putRecord');
    // Removed, not blanked: an empty string in the record would be a value every
    // consumer then has to treat as falsy-but-present.
    assert.ok(!('meetingUrl' in write.body.record));

    assert.equal(sentEmails.length, 2);
    assert.match(sentEmails[0].subject, /removed/i);
    const ics = Buffer.from(sentEmails[0].attachments[0].content, 'base64').toString();
    assert.doesNotMatch(ics, /^LOCATION:/m);
  });

  it('refuses a poll that has no scheduled time yet', async () => {
    pollRecord = { title: 'Weekly sync', status: 'open' };
    const res = await request(createApp(), { meetingUrl: 'https://meet.jit.si/x' });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /no scheduled time/i);
    assert.deepEqual(xrpcCalls, []);
    assert.deepEqual(sentEmails, []);
  });

  it('refuses anyone but the creator, before reading or mailing anything', async () => {
    const res = await request(createApp(), { meetingUrl: 'https://meet.jit.si/x' }, 'avails_session=stranger-session');
    assert.equal(res.status, 403);
    assert.deepEqual(xrpcCalls, []);
    assert.deepEqual(sentEmails, []);
  });

  it('refuses an anonymous caller', async () => {
    const res = await request(createApp(), { meetingUrl: 'https://meet.jit.si/x' }, null);
    assert.equal(res.status, 401);
    assert.deepEqual(sentEmails, []);
  });

  it('rejects a hostile URL before anything is written or sent', async () => {
    for (const hostile of ['javascript:alert(1)', 'https://ok.test/a\r\nX-EVIL:1', 'not a url']) {
      xrpcCalls = [];
      sentEmails = [];
      const res = await request(createApp(), { meetingUrl: hostile });
      assert.equal(res.status, 400, hostile);
      assert.deepEqual(xrpcCalls, []);
      assert.deepEqual(sentEmails, []);
    }
  });

  it('requires the field: a missing meetingUrl is malformed, not a removal', async () => {
    // Absence must not silently mean "clear it" — that would let a buggy client
    // wipe the link and mail everyone about it.
    const res = await request(createApp(), {});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /required/i);
    assert.deepEqual(xrpcCalls, []);
  });

  it('still succeeds when nobody left an email address', async () => {
    responseRecords = [response('Alice', null)];
    const res = await request(createApp(), { meetingUrl: 'https://meet.jit.si/avails-poll1' });

    assert.equal(res.status, 200);
    assert.equal(res.body.changed, true);
    assert.equal(res.body.notified, 0);
    assert.ok(xrpcCalls.find((c) => c.method === 'com.atproto.repo.putRecord'), 'the link is still saved');
    assert.deepEqual(sentEmails, []);
  });
});
