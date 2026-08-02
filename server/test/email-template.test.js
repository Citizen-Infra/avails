import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeEmail } from '../src/lib/email-template.js';
import { sendEmail } from '../src/lib/email.js';

// A poll title is user-supplied and ends up in an email body. Four of the five
// call sites interpolated it into HTML without escaping before avails#146.
const HOSTILE = `Team <script>alert("x")</script> & "friends" it's`;

test('escapes user-supplied text in the HTML part', () => {
  const { html } = composeEmail({
    heading: HOSTILE,
    paragraphs: [HOSTILE],
    action: { label: HOSTILE, url: 'https://example.test/p?a=1&b=2' },
    footer: HOSTILE,
  });
  assert.ok(!html.includes('<script>'), 'raw <script> reached the HTML');
  assert.ok(!html.includes('alert("x")'), 'unescaped quotes reached the HTML');
  assert.ok(html.includes('&lt;script&gt;'), 'expected escaped markup');
  assert.ok(html.includes('a=1&amp;b=2'), 'ampersand in the URL should be escaped');
});

test('leaves the plain-text part unescaped and readable', () => {
  const { text } = composeEmail({
    heading: HOSTILE,
    paragraphs: ['Plain sentence.'],
    action: null,
    footer: 'Why you got this.',
  });
  // Escaping is an HTML concern. Entities in a text/plain part would show up
  // literally as "&lt;" in the reader's client.
  assert.ok(text.includes(HOSTILE), 'text part should carry the original string');
  assert.ok(!text.includes('&lt;'), 'text part must not contain HTML entities');
});

test('always produces both parts, and the text part carries the link', () => {
  const url = 'https://avails.citizeninfra.org/poll/did:plc:abc/xyz';
  const { html, text } = composeEmail({
    heading: 'Standup is scheduled',
    paragraphs: ['Tuesday 12 August, 14:00, for 30 minutes.'],
    action: { label: 'View the poll', url },
    footer: 'You answered this poll.',
  });
  assert.ok(html.length > 0 && text.length > 0);
  assert.ok(text.includes(url), 'a text reader must still be able to reach the link');
  assert.ok(html.includes('<!doctype html>'), 'expected a real document, not a fragment');
});

test('omits the action block when there is nowhere to send the reader', () => {
  // schedule_call books from standing availability, so there is no poll page.
  const { html, text } = composeEmail({
    heading: 'Call is scheduled',
    paragraphs: ['Tuesday, for 30 minutes.'],
    action: null,
    footer: 'Your standing availability covered this time.',
  });
  assert.ok(!html.includes('<a '), 'no link expected');
  assert.ok(!text.includes('http'), 'no link expected in the text part either');
});

test('drops empty paragraphs so optional fields do not leave blank lines', () => {
  const { html, text } = composeEmail({
    heading: 'H',
    paragraphs: ['first', null, undefined, '', 'second'],
    footer: 'F',
  });
  assert.equal(html.match(/<p style="margin:0 0 14px 0/g).length, 2);
  assert.ok(!text.includes('\n\n\n'), 'no triple newline from a dropped paragraph');
});

test('sendEmail refuses an HTML-only message', async () => {
  // The guard must fire without RESEND_API_KEY set, otherwise it is unreachable
  // in development and only shows up in production.
  await assert.rejects(
    () => sendEmail({ to: 'a@example.test', subject: 's', html: '<p>x</p>' }),
    /text part is required/
  );
});
