import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Regression guard: publish_to_openmeet called an undefined requireAuth(), so it
// threw ReferenceError before any auth check. It must reject unauthenticated
// calls with AUTH_REQUIRED instead.
const { callTool } = await import('../src/mcp/tools.js');

describe('publish_to_openmeet auth', () => {
  it('throws AUTH_REQUIRED (not ReferenceError) with no auth context', async () => {
    await assert.rejects(
      () => callTool('publish_to_openmeet', { did: 'did:plc:x', rkey: 'r1' }, null),
      (err) => {
        assert.match(err.message, /AUTH_REQUIRED/);
        assert.doesNotMatch(err.message, /is not defined/);
        return true;
      }
    );
  });

  it('throws AUTH_REQUIRED when the auth context has no oauthSession', async () => {
    await assert.rejects(
      () => callTool('publish_to_openmeet', { did: 'did:plc:x', rkey: 'r1' }, { did: 'did:plc:x' }),
      /AUTH_REQUIRED/
    );
  });
});
