import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { callTool, listTools } = await import('../src/mcp/tools.js');
const { retireOpenMeet } = await import('../src/routes/openmeet.js');

describe('retired publish_to_openmeet tool', () => {
  it('is not advertised to MCP clients', () => {
    assert.equal(listTools().some((tool) => tool.name === 'publish_to_openmeet'), false);
  });

  it('rejects direct invocation before auth or network work', async () => {
    await assert.rejects(
      () => callTool('publish_to_openmeet', { did: 'did:plc:x', rkey: 'r1' }, null),
      /OPENMEET_RETIRED/
    );
  });

  it('returns 410 from legacy HTTP endpoints before auth or network work', () => {
    let statusCode;
    let payload;
    const response = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(value) {
        payload = value;
      },
    };

    retireOpenMeet({}, response);

    assert.equal(statusCode, 410);
    assert.equal(payload.error, 'openmeet-retired');
  });
});
