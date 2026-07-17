import { test } from 'node:test';
import assert from 'node:assert';
import { validateAvailability } from '../src/lib/availabilityValidate.js';

test('accepts a minimal valid record', () => {
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: 'at://did:plc:x/app.bsky.graph.list/abc' },
    pattern: { weekly: [{ day: 2, startTime: '14:00', endTime: '18:00' }] },
    timezone: 'Europe/Berlin',
    trust: 'confirm',
  });
  assert.equal(r.valid, true);
  assert.equal(r.value.trust, 'confirm');
});

test('rejects a bad day index', () => {
  const r = validateAvailability({
    scope: { type: 'atproto-list', value: 'at://x/app.bsky.graph.list/abc' },
    pattern: { weekly: [{ day: 9, startTime: '14:00', endTime: '18:00' }] },
    timezone: 'Europe/Berlin', trust: 'confirm',
  });
  assert.equal(r.valid, false);
});

test('rejects unknown trust value and strips unknown fields', () => {
  const bad = validateAvailability({ scope:{type:'atproto-list',value:'at://x/app.bsky.graph.list/a'}, pattern:{weekly:[{day:1,startTime:'09:00',endTime:'12:00'}]}, timezone:'UTC', trust:'always' });
  assert.equal(bad.valid, false);
  const ok = validateAvailability({ scope:{type:'atproto-list',value:'at://x/app.bsky.graph.list/a'}, pattern:{weekly:[{day:1,startTime:'09:00',endTime:'12:00'}]}, timezone:'UTC', trust:'auto', injected:'evil' });
  assert.equal(ok.valid, true);
  assert.equal(ok.value.injected, undefined);
});
