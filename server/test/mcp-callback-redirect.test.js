import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redirectMcpClient } from '../src/lib/mcpCallbackRedirect.js';

describe('MCP OAuth callback handoff', () => {
  it('uses an immediate HTTP redirect to the registered client callback', () => {
    const callback = 'http://127.0.0.1:48945/callback?code=one-time-code&state=client-state';
    const response = {
      statusCode: null,
      headers: new Map(),
      ended: false,
      status(code) { this.statusCode = code; return this; },
      set(name, value) { this.headers.set(name.toLowerCase(), value); return this; },
      end() { this.ended = true; return this; },
    };

    const result = redirectMcpClient(response, callback);

    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.get('location'), callback);
    assert.equal(response.ended, true);
    assert.equal(result, response);
  });
});
