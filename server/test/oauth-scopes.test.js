import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ATPROTO_SCOPE, ATPROTO_SCOPES } from '../src/lib/oauthScopes.js';

describe('ATProto OAuth scopes', () => {
  it('does not request the retired OpenMeet permission', () => {
    assert.equal(ATPROTO_SCOPES.some((scope) => scope.includes('openmeet')), false);
    assert.doesNotMatch(ATPROTO_SCOPE, /openmeet/i);
  });

  it('retains the scopes used by active Avails features', () => {
    assert.deepEqual(ATPROTO_SCOPES, [
      'atproto',
      'repo:chat.avails.scheduling.poll',
      'repo:chat.avails.scheduling.response',
      'repo:chat.avails.scheduling.availability',
    ]);
  });
});
