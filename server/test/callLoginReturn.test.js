import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callLoginState, callLoginReturn } from '../src/lib/callLoginReturn.js';

test('a valid booking survives verified OAuth application-state round trip', () => {
  const id = 'f5dbd07c-0279-4f6e-8a6a-f320fe03cc6f';
  assert.equal(callLoginReturn(callLoginState(id)), `/calls/${id}`);
});

test('arbitrary, malformed, absent, or MCP states cannot redirect to another site or route', () => {
  for (const value of [null, undefined, '', [], ['f5dbd07c-0279-4f6e-8a6a-f320fe03cc6f'],
    'https://attacker.test', '//attacker.test', '../admin', 'call:../admin',
    'call:https://attacker.test', 'mcp:existing-flow', 'call:not-a-uuid']) {
    assert.equal(callLoginState(value), undefined);
    assert.equal(callLoginReturn(value), '/');
  }
});
