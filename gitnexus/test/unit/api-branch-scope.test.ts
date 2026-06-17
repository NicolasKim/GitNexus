import { describe, expect, it } from 'vitest';
import type express from 'express';
import { requestedBranch, scopeEntryToBranch } from '../../src/server/api.js';

describe('requestedBranch', () => {
  it('reads branch from query string', () => {
    const req = { query: { branch: 'develop' }, body: {} } as express.Request;
    expect(requestedBranch(req)).toBe('develop');
  });

  it('reads branch from JSON body', () => {
    const req = { query: {}, body: { branch: 'feature/x' } } as express.Request;
    expect(requestedBranch(req)).toBe('feature/x');
  });

  it('returns undefined when branch is absent', () => {
    const req = { query: {}, body: {} } as express.Request;
    expect(requestedBranch(req)).toBeUndefined();
  });
});

describe('scopeEntryToBranch', () => {
  const entry = {
    name: 'demo',
    path: '/tmp/demo',
    storagePath: '/tmp/demo/.gitnexus',
    branch: 'main',
    branches: [
      {
        branch: 'develop',
        indexedAt: '2026-01-01T00:00:00.000Z',
        lastCommit: 'abc12345',
      },
    ],
  };

  it('returns flat paths when branch is omitted', async () => {
    const scoped = await scopeEntryToBranch(entry);
    expect(scoped.lbugPath).toBe('/tmp/demo/.gitnexus/lbug');
    expect(scoped.metaPath).toBe('/tmp/demo/.gitnexus/meta.json');
  });

  it('returns primary branch flat paths when branch matches entry.branch', async () => {
    const scoped = await scopeEntryToBranch(entry, 'main');
    expect(scoped.lbugPath).toBe('/tmp/demo/.gitnexus/lbug');
    expect(scoped.branch).toBe('main');
  });

  it('returns branches/<slug> paths for a recorded non-primary branch', async () => {
    const scoped = await scopeEntryToBranch(entry, 'develop');
    expect(scoped.lbugPath).toContain('/.gitnexus/branches/');
    expect(scoped.lbugPath.endsWith('/lbug')).toBe(true);
    expect(scoped.branch).toBe('develop');
  });

  it('throws for an unknown branch', async () => {
    await expect(scopeEntryToBranch(entry, 'nope')).rejects.toMatchObject({
      message: expect.stringContaining('Branch "nope" is not indexed'),
    });
  });
});
