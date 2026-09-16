import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lexicon = JSON.parse(
  readFileSync(new URL('../../lexicons/chat/avails/scheduling/poll.json', import.meta.url), 'utf8')
);
const generatedDefs = readFileSync(
  new URL('../src/lexicons/chat/avails/scheduling/poll.defs.ts', import.meta.url),
  'utf8'
);

test('poll lexicon advertises the open and finalized lifecycle', () => {
  assert.deepEqual(
    lexicon.defs.main.record.properties.status.knownValues,
    ['open', 'finalized']
  );
});

test('generated poll definitions match the source status values', () => {
  assert.match(generatedDefs, /status: 'open' \| 'finalized' \| l\.UnknownString/);
  assert.match(generatedDefs, /knownValues: \['open', 'finalized'\]/);
});
