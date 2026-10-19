import { describe, expect, it } from 'vitest';
import { MCP_SESSION_IDLE_TTL_MS } from '../../src/mcp/http-transport.js';

describe('MCP session idle TTL (foruver)', () => {
  it('should use a 24h finite TTL so live agents are not evicted at 30min while leaks still reclaim', () => {
    // Arrange / Assert
    expect(MCP_SESSION_IDLE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
