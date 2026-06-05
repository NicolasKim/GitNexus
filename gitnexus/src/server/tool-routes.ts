/**
 * REST Tool Gateway — exposes MCP tools over HTTP without modifying existing routes.
 *
 * POST /api/tools/:toolName delegates to LocalBackend.callTool() with the same
 * parameters as MCP tools/call.
 */

import type { Express, Request, Response } from 'express';
import { GITNEXUS_TOOLS } from '../mcp/tools.js';
import type { LocalBackend } from '../mcp/local/local-backend.js';
import { createRouteLimiter, assertString } from './validation.js';

const TOOL_NAMES = new Set(GITNEXUS_TOOLS.map((t) => t.name));

/** Tools that mutate filesystem or group state — tighter rate limit. */
const WRITE_TOOLS = new Set(['rename', 'group_sync']);

function toolErrorStatus(message: string): number {
  const lower = message.toLowerCase();
  if (
    lower.includes('not found') ||
    lower.includes('no indexed repositories') ||
    lower.includes('unknown tool') ||
    lower.includes('unknown repo')
  ) {
    return 404;
  }
  return 400;
}

export async function handleToolCall(
  backend: LocalBackend,
  toolName: string,
  params: Record<string, unknown> | undefined,
): Promise<unknown> {
  if (!TOOL_NAMES.has(toolName)) {
    const err = new Error(`Unknown tool: ${toolName}`);
    (err as Error & { status: number }).status = 404;
    throw err;
  }
  return backend.callTool(toolName, params ?? {});
}

export async function handleToolCallRequest(
  backend: LocalBackend,
  req: Request,
  res: Response,
): Promise<void> {
  let toolName: string;
  try {
    toolName = assertString(req.params.toolName, 'toolName');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid tool name';
    res.status(400).json({ error: message });
    return;
  }

  if (!TOOL_NAMES.has(toolName)) {
    res.status(404).json({ error: `Unknown tool: ${toolName}` });
    return;
  }

  try {
    const body = req.body;
    const params =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const result = await backend.callTool(toolName, params);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Tool call failed';
    const status =
      err instanceof Error && 'status' in err && typeof (err as any).status === 'number'
        ? (err as any).status
        : toolErrorStatus(message);
    res.status(status).json({ error: message });
  }
}

export function mountToolRoutes(app: Express, backend: LocalBackend): void {
  app.get('/api/tools', (_req, res) => {
    res.json({ tools: GITNEXUS_TOOLS });
  });

  const readLimiter = createRouteLimiter();
  const writeLimiter = createRouteLimiter({ limit: 10 });

  app.post(
    '/api/tools/:toolName',
    (req, res, next) => {
      const raw = req.params.toolName;
      const name = typeof raw === 'string' ? raw : '';
      const limiter = WRITE_TOOLS.has(name) ? writeLimiter : readLimiter;
      limiter(req, res, next);
    },
    (req, res) => {
      void handleToolCallRequest(backend, req, res);
    },
  );
}
