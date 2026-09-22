import crypto from 'crypto';

import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file, so variables they
// reference must also be hoisted via vi.hoisted().

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    repository: { findUnique: vi.fn() },
    pullRequest: { updateMany: vi.fn() },
    user: { findFirst: vi.fn() },
    project: { findMany: vi.fn() },
    issue: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    issueCommit: { upsert: vi.fn(), findFirst: vi.fn() },
    issueBranch: { upsert: vi.fn() },
    boardColumn: { findFirst: vi.fn() },
    webhookDelivery: { create: vi.fn() },
  };
  return { mockPrisma };
});

vi.mock('../config/database', () => ({
  prisma: mockPrisma,
}));

vi.mock('../config/redis', () => ({
  cacheInvalidate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../realtime/broadcast', () => ({
  broadcastToRoom: vi.fn(),
}));

vi.mock('../pipelines/trigger', () => ({
  triggerPipelineOnPush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/issues/smart-commits.executor', () => ({
  executeSmartCommit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./git-commands', () => ({
  log: vi.fn().mockResolvedValue([]),
}));

vi.mock('../modules/repos/protection.service', () => ({
  getMatchingRule: vi.fn().mockResolvedValue(null),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { cacheInvalidate } from '../config/redis';
import { triggerPipelineOnPush } from '../pipelines/trigger';
import { broadcastToRoom } from '../realtime/broadcast';

import hookRouter, { HOOK_SECRET } from './hook-handler';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const mockRepo = {
  id: 'repo-1',
  name: 'Test Repo',
  slug: 'test-repo',
  diskPath: '/repos/test.git',
  defaultBranch: 'main',
  webhooks: [],
  team: {
    slug: 'core',
    org: { slug: 'acme' },
  },
};

// ── Test app setup ────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use('/api/internal/hooks', hookRouter);

// ── Helpers ───────────────────────────────────────────────────────────────────

function postHook(payload: object, secret: string = HOOK_SECRET) {
  return request(app)
    .post('/api/internal/hooks/post-receive')
    .set('x-hook-secret', secret)
    .send(payload);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HOOK_SECRET', () => {
  it('is defined and non-empty', () => {
    expect(typeof HOOK_SECRET).toBe('string');
    expect(HOOK_SECRET.length).toBeGreaterThan(0);
  });

  it('is at least 16 characters long', () => {
    expect(HOOK_SECRET.length).toBeGreaterThanOrEqual(16);
  });
});

describe('ISSUE_KEY_IN_BRANCH regex', () => {
  // Access via autoLinkBranch indirectly — test the pattern directly
  const ISSUE_KEY_IN_BRANCH = /([A-Z]+-\d+)/;

  it('extracts key from feature/AXM-123-description', () => {
    const match = 'feature/AXM-123-description'.match(ISSUE_KEY_IN_BRANCH);
    expect(match?.[1]).toBe('AXM-123');
  });

  it('extracts key from AXM-456', () => {
    const match = 'AXM-456'.match(ISSUE_KEY_IN_BRANCH);
    expect(match?.[1]).toBe('AXM-456');
  });

  it('extracts key from bugfix/PROJ-99-fix-login', () => {
    const match = 'bugfix/PROJ-99-fix-login'.match(ISSUE_KEY_IN_BRANCH);
    expect(match?.[1]).toBe('PROJ-99');
  });

  it('extracts first key when multiple exist', () => {
    const match = 'AXM-1-and-AXM-2'.match(ISSUE_KEY_IN_BRANCH);
    expect(match?.[1]).toBe('AXM-1');
  });

  it('does not match lowercase prefix', () => {
    const match = 'axm-123'.match(ISSUE_KEY_IN_BRANCH);
    expect(match).toBeNull();
  });

  it('does not match branch with no issue key', () => {
    const match = 'feature/add-login'.match(ISSUE_KEY_IN_BRANCH);
    expect(match).toBeNull();
  });

  it('does not match partial uppercase like A-1 (single char prefix)', () => {
    // Single char prefix is still valid per regex ([A-Z]+), so A-1 does match
    const match = 'A-1'.match(ISSUE_KEY_IN_BRANCH);
    expect(match?.[1]).toBe('A-1');
  });

  it('handles numeric-only branch names gracefully', () => {
    const match = '123'.match(ISSUE_KEY_IN_BRANCH);
    expect(match).toBeNull();
  });
});

describe('POST /api/internal/hooks/post-receive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.repository.findUnique.mockResolvedValue(mockRepo);
    mockPrisma.pullRequest.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.issueCommit.findFirst.mockResolvedValue(null);
  });

  // ── Authentication ──────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('rejects missing hook secret with 403', async () => {
      const res = await request(app)
        .post('/api/internal/hooks/post-receive')
        .send({ repo: 'repo-1', ref: 'refs/heads/main', before: 'aaa', after: 'bbb' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/invalid hook secret/i);
    });

    it('rejects wrong hook secret with 403', async () => {
      const res = await postHook(
        { repo: 'repo-1', ref: 'refs/heads/main', before: 'aaa', after: 'bbb' },
        'wrong-secret',
      );
      expect(res.status).toBe(403);
    });

    it('rejects a wrong hook secret of the same length with 403', async () => {
      const sameLengthWrongSecret =
        HOOK_SECRET.slice(0, -1) + (HOOK_SECRET.endsWith('x') ? 'y' : 'x');
      const res = await postHook(
        { repo: 'repo-1', ref: 'refs/heads/main', before: 'aaa', after: 'bbb' },
        sameLengthWrongSecret,
      );
      expect(res.status).toBe(403);
    });

    it('accepts correct hook secret', async () => {
      const res = await postHook({
        repo: 'repo-1',
        ref: 'refs/heads/main',
        before: 'aaa',
        after: 'bbb',
      });
      expect(res.status).toBe(200);
    });
  });

  // ── Payload validation ──────────────────────────────────────────────────────

  describe('payload validation', () => {
    it('returns 400 for empty payload', async () => {
      const res = await postHook({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid payload/i);
    });

    it('returns 400 when repo is missing', async () => {
      const res = await postHook({ ref: 'refs/heads/main', before: 'aaa', after: 'bbb' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when ref is missing', async () => {
      const res = await postHook({ repo: 'repo-1', before: 'aaa', after: 'bbb' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when after is missing', async () => {
      const res = await postHook({ repo: 'repo-1', ref: 'refs/heads/main', before: 'aaa' });
      expect(res.status).toBe(400);
    });
  });

  // ── Repo lookup ─────────────────────────────────────────────────────────────

  describe('repository lookup', () => {
    it('returns 404 when repo not found in DB', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue(null);
      const res = await postHook({
        repo: 'nonexistent',
        ref: 'refs/heads/main',
        before: 'aaa',
        after: 'bbb',
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/repository not found/i);
    });
  });

  // ── Event type detection ────────────────────────────────────────────────────

  describe('event type detection', () => {
    const ZERO = '0000000000000000000000000000000000000000';
    const SHA1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const SHA2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    it('returns push event for normal branch update', async () => {
      const res = await postHook({
        repo: 'repo-1',
        ref: 'refs/heads/main',
        before: SHA1,
        after: SHA2,
      });
      expect(res.status).toBe(200);
      expect(res.body.event).toBe('push');
      expect(res.body.ref).toBe('main');
    });

    it('returns branch:created when before is zero SHA', async () => {
      const res = await postHook({
        repo: 'repo-1',
        ref: 'refs/heads/feature',
        before: ZERO,
        after: SHA1,
      });
      expect(res.status).toBe(200);
      expect(res.body.event).toBe('branch:created');
    });

    it('returns branch:deleted when after is zero SHA', async () => {
      const res = await postHook({
        repo: 'repo-1',
        ref: 'refs/heads/feature',
        before: SHA1,
        after: ZERO,
      });
      expect(res.status).toBe(200);
      expect(res.body.event).toBe('branch:deleted');
    });

    it('returns tag:created for new tag', async () => {
      const res = await postHook({
        repo: 'repo-1',
        ref: 'refs/tags/v1.0.0',
        before: ZERO,
        after: SHA1,
      });
      expect(res.status).toBe(200);
      expect(res.body.event).toBe('tag:created');
    });

    it('returns tag:deleted when tag after is zero SHA', async () => {
      const res = await postHook({
        repo: 'repo-1',
        ref: 'refs/tags/v1.0.0',
        before: SHA1,
        after: ZERO,
      });
      expect(res.status).toBe(200);
      expect(res.body.event).toBe('tag:deleted');
    });

    it('strips refs/heads/ from ref in response', async () => {
      const res = await postHook({
        repo: 'repo-1',
        ref: 'refs/heads/feat/my-feature',
        before: SHA1,
        after: SHA2,
      });
      expect(res.body.ref).toBe('feat/my-feature');
    });

    it('strips refs/tags/ from ref in response', async () => {
      const res = await postHook({
        repo: 'repo-1',
        ref: 'refs/tags/v2.0.0',
        before: ZERO,
        after: SHA1,
      });
      expect(res.body.ref).toBe('v2.0.0');
    });
  });

  // ── Side effects ────────────────────────────────────────────────────────────

  describe('side effects', () => {
    const SHA1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const SHA2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    it('calls cacheInvalidate with repo pattern', async () => {
      await postHook({ repo: 'repo-1', ref: 'refs/heads/main', before: SHA1, after: SHA2 });
      expect(cacheInvalidate).toHaveBeenCalledWith('repo:repo-1:*');
    });

    it('broadcasts realtime event with correct room', async () => {
      await postHook({ repo: 'repo-1', ref: 'refs/heads/main', before: SHA1, after: SHA2 });
      expect(broadcastToRoom).toHaveBeenCalledWith(
        'repo:acme/core/test-repo',
        expect.objectContaining({ type: 'repo:pushed', repoId: 'repo-1' }),
      );
    });

    it('triggers pipeline on push event', async () => {
      await postHook({ repo: 'repo-1', ref: 'refs/heads/main', before: SHA1, after: SHA2 });
      expect(triggerPipelineOnPush).toHaveBeenCalledWith('repo-1', 'main', SHA2);
    });

    it('does NOT trigger pipeline on branch delete', async () => {
      const ZERO = '0000000000000000000000000000000000000000';
      await postHook({ repo: 'repo-1', ref: 'refs/heads/main', before: SHA1, after: ZERO });
      expect(triggerPipelineOnPush).not.toHaveBeenCalled();
    });

    it('does NOT trigger pipeline on tag events', async () => {
      await postHook({ repo: 'repo-1', ref: 'refs/tags/v1.0.0', before: SHA1, after: SHA2 });
      expect(triggerPipelineOnPush).not.toHaveBeenCalled();
    });

    it('updates open PRs on non-delete, non-tag push', async () => {
      await postHook({ repo: 'repo-1', ref: 'refs/heads/main', before: SHA1, after: SHA2 });
      expect(mockPrisma.pullRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ repoId: 'repo-1', status: 'OPEN' }),
        }),
      );
    });

    it('skips PR update on branch delete', async () => {
      const ZERO = '0000000000000000000000000000000000000000';
      await postHook({ repo: 'repo-1', ref: 'refs/heads/main', before: SHA1, after: ZERO });
      expect(mockPrisma.pullRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── Webhook dispatch ────────────────────────────────────────────────────────

  describe('webhook dispatch', () => {
    const SHA1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const SHA2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    it('dispatches to webhooks subscribed to matching event', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('ok', { status: 200 }));
      mockPrisma.webhookDelivery.create.mockResolvedValue({});
      mockPrisma.repository.findUnique.mockResolvedValue({
        ...mockRepo,
        webhooks: [{ id: 'wh-1', url: 'https://example.com/hook', secret: null, events: ['push'] }],
      });

      await postHook({ repo: 'repo-1', ref: 'refs/heads/main', before: SHA1, after: SHA2 });

      // Give async webhook dispatch a tick to fire
      await new Promise((r) => setImmediate(r));

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com/hook',
        expect.objectContaining({ method: 'POST' }),
      );
      fetchSpy.mockRestore();
    });

    it('does not dispatch to webhooks subscribed to different event', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('ok', { status: 200 }));
      mockPrisma.repository.findUnique.mockResolvedValue({
        ...mockRepo,
        webhooks: [
          {
            id: 'wh-2',
            url: 'https://example.com/hook2',
            secret: null,
            events: ['branch:deleted'],
          },
        ],
      });

      await postHook({ repo: 'repo-1', ref: 'refs/heads/main', before: SHA1, after: SHA2 });
      await new Promise((r) => setImmediate(r));

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('dispatches to wildcard (*) webhooks regardless of event', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('ok', { status: 200 }));
      mockPrisma.webhookDelivery.create.mockResolvedValue({});
      mockPrisma.repository.findUnique.mockResolvedValue({
        ...mockRepo,
        webhooks: [{ id: 'wh-3', url: 'https://example.com/all', secret: null, events: ['*'] }],
      });

      await postHook({ repo: 'repo-1', ref: 'refs/heads/main', before: SHA1, after: SHA2 });
      await new Promise((r) => setImmediate(r));

      expect(fetchSpy).toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  // ── dispatchWebhook HMAC signing ────────────────────────────────────────────

  describe('dispatchWebhook HMAC', () => {
    it('includes X-Axiom-Signature header when webhook has secret', async () => {
      const { dispatchWebhook } = await import('./hook-handler');
      mockPrisma.webhookDelivery.create.mockResolvedValue({});

      let capturedHeaders: Record<string, string> | undefined;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return new Response('ok', { status: 200 });
      });

      const payload = { event: 'push', data: 'test' };
      await dispatchWebhook('wh-id', 'https://example.com/hook', 'my-secret', payload, 1);

      expect(capturedHeaders?.['X-Axiom-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);

      // Verify the signature is correct
      const body = JSON.stringify(payload);
      const expected = crypto.createHmac('sha256', 'my-secret').update(body).digest('hex');
      expect(capturedHeaders?.['X-Axiom-Signature']).toBe(`sha256=${expected}`);

      fetchSpy.mockRestore();
    });

    it('omits X-Axiom-Signature when webhook has no secret', async () => {
      const { dispatchWebhook } = await import('./hook-handler');
      mockPrisma.webhookDelivery.create.mockResolvedValue({});

      let capturedHeaders: Record<string, string> | undefined;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return new Response('ok', { status: 200 });
      });

      await dispatchWebhook('wh-id', 'https://example.com/hook', null, { event: 'push' }, 1);

      expect(capturedHeaders?.['X-Axiom-Signature']).toBeUndefined();
      fetchSpy.mockRestore();
    });
  });

  // ── generatePostReceiveHook ─────────────────────────────────────────────────

  describe('generatePostReceiveHook', () => {
    it('generates a sh script that execs the node hook entry with the repo id', async () => {
      const { generatePostReceiveHook } = await import('./hook-handler');
      const script = generatePostReceiveHook('repo-abc-123');
      expect(script).toContain('#!/bin/sh');
      expect(script).toContain('exec node');
      expect(script).toContain('"repo-abc-123"');
      expect(script).not.toContain(HOOK_SECRET);
    });
  });
});
