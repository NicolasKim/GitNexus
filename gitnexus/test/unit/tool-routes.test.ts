/**
 * Unit tests for REST Tool Gateway (/api/tools).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import { GITNEXUS_TOOLS } from '../../src/mcp/tools.js';
import { mountToolRoutes, handleToolCallRequest } from '../../src/server/tool-routes.js';

function createMockBackend(overrides: Record<string, unknown> = {}) {
  return {
    callTool: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as any;
}

const invokeHandler = async (
  backend: any,
  toolName: string,
  body: unknown = {},
): Promise<{ status: number; body: any }> => {
  let capturedStatus = 200;
  let capturedBody: any = undefined;
  const req = {
    params: { toolName },
    body,
  } as express.Request;
  const res = {
    status(code: number) {
      capturedStatus = code;
      return this;
    },
    json(payload: any) {
      capturedBody = payload;
    },
  } as express.Response;

  await handleToolCallRequest(backend, req, res);
  return { status: capturedStatus, body: capturedBody };
};

describe('tool-routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/tools returns all MCP tool definitions', async () => {
    const app = express();
    const backend = createMockBackend();
    mountToolRoutes(app, backend);

    await new Promise<void>((resolve, reject) => {
      const server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr !== 'object' || !addr) {
          server.close();
          reject(new Error('no address'));
          return;
        }
        http
          .get(`http://127.0.0.1:${addr.port}/api/tools`, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              server.close();
              const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              expect(res.statusCode).toBe(200);
              expect(payload.tools).toHaveLength(GITNEXUS_TOOLS.length);
              expect(payload.tools.map((t: { name: string }) => t.name)).toEqual(
                GITNEXUS_TOOLS.map((t) => t.name),
              );
              resolve();
            });
          })
          .on('error', (err) => {
            server.close();
            reject(err);
          });
      });
    });
  });

  it('POST /api/tools/list_repos delegates to backend.callTool', async () => {
    const backend = createMockBackend({
      callTool: vi.fn().mockResolvedValue([{ name: 'demo', path: '/tmp/demo' }]),
    });
    const { status, body } = await invokeHandler(backend, 'list_repos', {});
    expect(status).toBe(200);
    expect(body).toEqual([{ name: 'demo', path: '/tmp/demo' }]);
    expect(backend.callTool).toHaveBeenCalledWith('list_repos', {});
  });

  it('POST /api/tools/query forwards body params', async () => {
    const backend = createMockBackend({
      callTool: vi.fn().mockResolvedValue({ processes: [] }),
    });
    const params = { query: 'auth', repo: 'my-app' };
    const { status, body } = await invokeHandler(backend, 'query', params);
    expect(status).toBe(200);
    expect(body).toEqual({ processes: [] });
    expect(backend.callTool).toHaveBeenCalledWith('query', params);
  });

  it('returns 404 for unknown tool name', async () => {
    const backend = createMockBackend();
    const { status, body } = await invokeHandler(backend, 'not_a_tool', {});
    expect(status).toBe(404);
    expect(body.error).toContain('Unknown tool');
    expect(backend.callTool).not.toHaveBeenCalled();
  });

  it('maps repo-not-found errors to 404', async () => {
    const backend = createMockBackend({
      callTool: vi
        .fn()
        .mockRejectedValue(new Error('Repository "missing" not found. Available: a')),
    });
    const { status, body } = await invokeHandler(backend, 'query', { query: 'x', repo: 'missing' });
    expect(status).toBe(404);
    expect(body.error).toContain('not found');
  });

  it('maps other backend errors to 400', async () => {
    const backend = createMockBackend({
      callTool: vi.fn().mockRejectedValue(new Error('query parameter is required')),
    });
    const { status, body } = await invokeHandler(backend, 'query', {});
    expect(status).toBe(400);
    expect(body.error).toContain('required');
  });
});
