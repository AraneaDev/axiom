import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DEFAULT_POLICY, isToken, needsApproval, type EffectivePolicy } from './approval-policy';
import { defineAction, type ActionContext } from './define';

const base = {
  area: 'issues' as const,
  kind: 'write' as const,
  summary: 'x',
  input: z.object({}),
  output: z.object({}).loose(),
  authorize: async () => {},
  handler: async () => ({}),
};

const session: ActionContext = { userId: 'u1', channel: 'ui' };
const rest: ActionContext = {
  userId: 'u1',
  channel: 'rest-token',
  apiTokenId: 't1',
  scopes: ['issues:write'],
};
const mcp: ActionContext = { ...rest, channel: 'mcp' };

const plain = defineAction({ ...base, name: 'test.plain' });
const destructive = defineAction({ ...base, name: 'test.delete', destructive: true });
const admin = defineAction({ ...base, name: 'test.admin', admin: true });
const bulk = defineAction({
  ...base,
  name: 'test.bulk',
  input: z.object({ ids: z.array(z.string()) }),
  bulkCount: (input: { ids: string[] }) => input.ids.length,
});
const move = (crosses: boolean) =>
  defineAction({ ...base, name: 'test.move', crossContainer: async () => crosses });

const ids = (n: number) => ({ ids: Array.from({ length: n }, (_, i) => `i${i}`) });

describe('DEFAULT_POLICY', () => {
  it('holds the agreed defaults', () => {
    expect(DEFAULT_POLICY).toEqual({
      requireFor: { destructive: true, admin: true, bulkOver: 10, crossContainerMove: true },
      expiresMinutes: 60,
    });
  });
});

describe('isToken', () => {
  it('is false for a browser session and true for every token signal', () => {
    expect(isToken(session)).toBe(false);
    expect(isToken(rest)).toBe(true);
    expect(isToken(mcp)).toBe(true);
    expect(isToken({ userId: 'u1', channel: 'ui', apiTokenId: 't1' })).toBe(true);
    expect(isToken({ userId: 'u1', channel: 'ui', scopes: [] })).toBe(true);
  });
});

describe('needsApproval', () => {
  it('never gates a browser session, not even an admin action', async () => {
    for (const def of [plain, destructive, admin, bulk, move(true)]) {
      expect(await needsApproval(def, ids(50), session, DEFAULT_POLICY)).toBe(false);
    }
  });

  it('lets a plain write through for a token', async () => {
    expect(await needsApproval(plain, {}, rest, DEFAULT_POLICY)).toBe(false);
    expect(await needsApproval(plain, {}, mcp, DEFAULT_POLICY)).toBe(false);
  });

  it('gates a destructive action for a token by default', async () => {
    expect(await needsApproval(destructive, {}, rest, DEFAULT_POLICY)).toBe(true);
    expect(await needsApproval(destructive, {}, mcp, DEFAULT_POLICY)).toBe(true);
  });

  it('lets a destructive action through when the policy turns it off', async () => {
    const policy: EffectivePolicy = {
      ...DEFAULT_POLICY,
      requireFor: { ...DEFAULT_POLICY.requireFor, destructive: false },
    };
    expect(await needsApproval(destructive, {}, rest, policy)).toBe(false);
  });

  it('always gates an admin action, whatever the policy says', async () => {
    const off: EffectivePolicy = {
      ...DEFAULT_POLICY,
      requireFor: { destructive: false, admin: false, bulkOver: 1000, crossContainerMove: false },
    };
    expect(await needsApproval(admin, {}, rest, off)).toBe(true);
    expect(await needsApproval(admin, {}, mcp, DEFAULT_POLICY)).toBe(true);
  });

  it('gates a bulk only over the threshold: 10 passes, 11 asks', async () => {
    expect(await needsApproval(bulk, ids(10), rest, DEFAULT_POLICY)).toBe(false);
    expect(await needsApproval(bulk, ids(11), rest, DEFAULT_POLICY)).toBe(true);
  });

  it('follows the threshold of the policy', async () => {
    const policy: EffectivePolicy = {
      ...DEFAULT_POLICY,
      requireFor: { ...DEFAULT_POLICY.requireFor, bulkOver: 3 },
    };
    expect(await needsApproval(bulk, ids(3), rest, policy)).toBe(false);
    expect(await needsApproval(bulk, ids(4), rest, policy)).toBe(true);
  });

  it('gates a move only when the database says it crosses a container', async () => {
    expect(await needsApproval(move(true), {}, rest, DEFAULT_POLICY)).toBe(true);
    expect(await needsApproval(move(false), {}, rest, DEFAULT_POLICY)).toBe(false);
  });

  it('lets a crossing move through when the policy turns it off', async () => {
    const policy: EffectivePolicy = {
      ...DEFAULT_POLICY,
      requireFor: { ...DEFAULT_POLICY.requireFor, crossContainerMove: false },
    };
    expect(await needsApproval(move(true), {}, rest, policy)).toBe(false);
  });
});
