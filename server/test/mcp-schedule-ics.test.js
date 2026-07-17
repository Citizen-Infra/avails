/**
 * Regression tests for the `schedule` MCP tool's calendar-invite path (#105).
 *
 * `schedule` called generateIcs(updatedRecord, url, participants) positionally,
 * but generateIcs takes a single destructured object — so `poll` resolved to
 * `updatedRecord.poll` (undefined) and `new Date(poll.finalTime)` threw. The
 * call sits above the email filter, so it threw on EVERY finalize whose
 * responses fetch succeeded, not only ones with participant emails — and it
 * threw *after* the record was already written to the PDS, leaving the poll
 * finalized but the tool errored.
 *
 * Requires --experimental-test-module-mocks (mock.module below), so this file
 * belongs in the second (mock) group in package.json's test script.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.CLIENT_URL = 'https://avails.test';

const DID = 'did:plc:creator';
const RKEY = 'poll1';
const PDS = 'https://pds.test';
const POLL_URI = `at://${DID}/chat.avails.scheduling.poll/${RKEY}`;

let sendEmailCalls;

mock.module('../src/lib/email.js', {
  namedExports: {
    sendEmail: async (opts) => {
      sendEmailCalls.push(opts);
      return { id: 'mock-email' };
    },
  },
});

// Response records the mocked PDS listRecords returns; each test sets these.
let responseRecords;

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('https://plc.directory/')) {
    return {
      ok: true,
      json: async () => ({
        service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
      }),
    };
  }
  if (u.includes('com.atproto.repo.getRecord')) {
    return {
      ok: true,
      json: async () => ({
        cid: 'cid-existing',
        value: {
          title: 'Weekly sync',
          description: 'Agenda in the doc',
          timezone: 'UTC',
          status: 'open',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      }),
    };
  }
  if (u.includes('com.atproto.repo.listRecords')) {
    return { ok: true, json: async () => ({ records: responseRecords }) };
  }
  throw new Error(`Unexpected fetch() call in schedule ICS test: ${u}`);
};

const { callTool } = await import('../src/mcp/tools.js');

function authContext() {
  return {
    did: DID,
    oauthSession: {
      fetchHandler: async () => ({ ok: true, json: async () => ({}) }),
    },
  };
}

const ARGS = {
  did: DID,
  rkey: RKEY,
  finalTime: '2026-07-21T14:00:00.000Z',
  finalDuration: 60,
};

describe('schedule MCP tool — calendar invite (#105)', () => {
  it('finalizes without throwing when no participant supplied an email', async () => {
    sendEmailCalls = [];
    responseRecords = [{ value: { pollUri: POLL_URI, name: 'Alice' } }];

    const result = JSON.parse(await callTool('schedule', ARGS, authContext()));

    assert.equal(result.scheduled, true);
    assert.equal(result.emailsSent, 0);
    assert.deepEqual(sendEmailCalls, []);
  });

  it('attaches a valid ICS invite when a participant supplied an email', async () => {
    sendEmailCalls = [];
    responseRecords = [
      { value: { pollUri: POLL_URI, name: 'Alice', email: 'alice@test.dev' } },
      { value: { pollUri: POLL_URI, name: 'Bob' } },
    ];

    const result = JSON.parse(await callTool('schedule', ARGS, authContext()));

    assert.equal(result.scheduled, true);
    assert.equal(result.emailsSent, 1);
    assert.equal(sendEmailCalls.length, 1);
    assert.equal(sendEmailCalls[0].to, 'alice@test.dev');

    const ics = Buffer.from(sendEmailCalls[0].attachments[0].content, 'base64').toString('utf8');
    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, /SUMMARY:Weekly sync/);
    assert.match(ics, /DTSTART:20260721T140000Z/);
    // Deterministic UID must resolve from did/rkey, not "avails-undefined-undefined@…"
    assert.match(ics, /UID:avails-did:plc:creator-poll1@avails\.test/);
    assert.doesNotMatch(ics, /undefined/);
    // Participants are surfaced in the description, proving they were passed through.
    assert.match(ics, /Alice/);
  });
});
