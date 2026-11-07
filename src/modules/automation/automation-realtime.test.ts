/**
 * What a rule writes in the worker reaches the browsers: the worker has no sockets, so the event
 * goes over the Redis bridge and the API broadcasts it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../config/database';
import {
  closeRealtimePublisher,
  realtimePublisherReady,
  setRealtimeMode,
  startRealtimeSubscriber,
  type RealtimeSubscriber,
} from '../../realtime/bridge';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';

import { createRule, evaluateRules } from './automation.service';

let ctx: TestContext;
let issueId: string;
let doneColumn: string;
const subscribers: RealtimeSubscriber[] = [];
const received: Array<[string, { type: string; issueId?: string }]> = [];

beforeAll(async () => {
  ctx = await createTestContext('rtm');
  doneColumn = (
    await prisma.boardColumn.findFirstOrThrow({
      where: { projectId: ctx.projectId },
      orderBy: { position: 'desc' },
    })
  ).id;
  issueId = (
    await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 1,
        title: 'Realtime',
        body: '',
        creatorId: ctx.owner.id,
      },
    })
  ).id;
});

afterEach(() => {
  setRealtimeMode('local');
  closeRealtimePublisher();
  received.length = 0;
  while (subscribers.length) subscribers.pop()!.stop();
});

afterAll(async () => {
  await cleanupTestContext(ctx);
});

describe('automation writes in worker mode', () => {
  it('reaches the API broadcast for a status change and a comment, in the project room', async () => {
    await createRule(ctx.projectId, {
      name: 'move and say',
      trigger: 'issue:created',
      actions: [
        { type: 'set_status', columnId: doneColumn },
        { type: 'add_comment', body: 'moved' },
      ],
    });
    setRealtimeMode('redis');
    await realtimePublisherReady();
    const subscriber = startRealtimeSubscriber((room, e) => {
      received.push([room, e as never]);
    });
    subscribers.push(subscriber);
    await subscriber.ready;

    await evaluateRules(ctx.projectId, 'issue:created', {
      issue: { id: issueId, projectId: ctx.projectId },
      actorId: ctx.owner.id,
    });

    await vi.waitFor(() => expect(received).toHaveLength(2));
    const room = `project:${ctx.projectId}`;
    expect(received.map(([r, e]) => [r, e.type, e.issueId])).toEqual([
      [room, 'board:moved', issueId],
      [room, 'comment:added', issueId],
    ]);
  });
});
