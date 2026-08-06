/**
 * The meeting link attached to a scheduled poll (#19).
 *
 * This value is supplied by a user, stored in a world-readable PDS record,
 * rendered as an href in the finalized banner, and written into an .ics that
 * lands in participants' calendar apps. The normalizer is the only thing
 * standing between those three consumers and a hostile string, so it is tested
 * as a security boundary rather than as a formatting helper.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMeetingUrl } from '../src/lib/meetingUrl.js';
import { generateIcs } from '../src/lib/ical.js';

describe('normalizeMeetingUrl', () => {
  it('accepts ordinary meeting links unchanged', () => {
    for (const url of [
      'https://meet.jit.si/avails-3lkq2xyz',
      'https://meet.google.com/abc-defg-hij',
      'https://us02web.zoom.us/j/12345678901?pwd=Abc123',
      'http://internal.example.test/room/7',
    ]) {
      assert.equal(normalizeMeetingUrl(url), url);
    }
  });

  it('treats absence and emptiness as "no link", not as an error', () => {
    // An empty string is how a caller CLEARS a link, so it must not throw.
    for (const v of [undefined, null, '', '   ']) {
      assert.equal(normalizeMeetingUrl(v), null);
    }
  });

  it('trims surrounding whitespace from a pasted link', () => {
    assert.equal(normalizeMeetingUrl('  https://meet.jit.si/room  '), 'https://meet.jit.si/room');
  });

  it('rejects javascript: and data: URLs — the banner renders this as an href', () => {
    // These parse perfectly well as URLs. Without the scheme allowlist each one
    // is a working XSS the moment someone clicks the join link; there is no
    // sanitiser downstream of this.
    for (const hostile of [
      'javascript:alert(document.cookie)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      assert.throws(() => normalizeMeetingUrl(hostile), /http or https/i, hostile);
    }
  });

  it('rejects line breaks and tabs, which are injection primitives in an .ics', () => {
    // iCalendar is line-oriented and built on CRLF, so a newline in a property
    // value can forge further properties. This must be caught BEFORE parsing:
    // WHATWG URL silently strips these, so a check on the parsed href would
    // launder the string and report success.
    for (const hostile of [
      'https://ok.test/a\r\nDESCRIPTION:injected',
      'https://ok.test/a\nX-EVIL:1',
      'https://ok.test/a\tb',
    ]) {
      assert.throws(() => normalizeMeetingUrl(hostile), /line breaks/i);
    }
  });

  it('rejects a string that is not a URL at all', () => {
    for (const bad of ['meet.jit.si/room', 'just some text', '://nope']) {
      assert.throws(() => normalizeMeetingUrl(bad), /valid URL/i);
    }
  });

  it('rejects a non-string and an over-long value', () => {
    assert.throws(() => normalizeMeetingUrl(42), /must be a string/);
    assert.throws(() => normalizeMeetingUrl({ url: 'https://x.test' }), /must be a string/);
    assert.throws(() => normalizeMeetingUrl(`https://x.test/${'a'.repeat(600)}`), /under 500/);
  });
});

// ---------------------------------------------------------------------------

describe('generateIcs with a meeting link', () => {
  const base = {
    pollUrl: 'https://avails.test/p/did:plc:creator/poll1',
    did: 'did:plc:creator',
    rkey: 'poll1',
  };
  const poll = {
    title: 'Weekly sync',
    finalTime: '2026-08-11T14:00:00.000Z',
    finalDuration: 60,
  };

  it('puts the link in LOCATION and in the description', () => {
    const ics = generateIcs({
      ...base,
      poll: { ...poll, meetingUrl: 'https://meet.jit.si/avails-poll1' },
    });
    // LOCATION is where calendar clients look for a join affordance; the
    // description is what survives a client that does not render one.
    assert.match(ics, /LOCATION:https:\/\/meet\.jit\.si\/avails-poll1/);
    assert.match(ics, /Join: https:\/\/meet\.jit\.si\/avails-poll1/);
  });

  it('leaves URL pointing at the poll, not the meeting room', () => {
    const ics = generateIcs({
      ...base,
      poll: { ...poll, meetingUrl: 'https://meet.jit.si/avails-poll1' },
    });
    // The poll is the durable record of the decision; the room is ephemeral.
    assert.match(ics, /URL[^\r\n]*avails\.test\/p\//);
    assert.doesNotMatch(ics, /^URL.*jit\.si/m);
  });

  it('omits LOCATION entirely when there is no link', () => {
    const ics = generateIcs({ ...base, poll });
    assert.doesNotMatch(ics, /^LOCATION:/m);
    assert.doesNotMatch(ics, /Join:/);
  });

  it('never carries a join link on a cancellation', () => {
    // A join link on a meeting that is not happening invites someone to sit in
    // an empty room. CANCEL's job is to remove the event, not to describe how
    // to attend it.
    const ics = generateIcs({
      ...base,
      poll: { ...poll, meetingUrl: 'https://meet.jit.si/avails-poll1' },
      method: 'CANCEL',
    });
    assert.match(ics, /METHOD:CANCEL/);
    assert.doesNotMatch(ics, /jit\.si/);
    assert.doesNotMatch(ics, /Join:/);
  });

  it('keeps the description order: what it is, how to join, who is coming', () => {
    const ics = generateIcs({
      ...base,
      poll: { ...poll, description: 'Sprint planning', meetingUrl: 'https://meet.jit.si/x' },
      participants: ['Alice', 'Bob'],
    });
    // Unfolded, because ical-generator wraps long lines at 75 octets and the
    // description is one folded property.
    const unfolded = ics.replace(/\r\n[ \t]/g, '');
    const desc = unfolded.split(/\r?\n/).find((l) => l.startsWith('DESCRIPTION:'));
    assert.ok(desc, 'has a DESCRIPTION property');
    assert.ok(
      desc.indexOf('Sprint planning') < desc.indexOf('Join:'),
      'the meeting link comes after what the meeting is'
    );
    assert.ok(
      desc.indexOf('Join:') < desc.indexOf('Participants:'),
      'the join link comes before the guest list — it is what someone opens this to find'
    );
  });
});
