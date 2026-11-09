/**
 * Queue the events a bot hears about the issues it is assigned to. Every issue write path calls
 * `emitIssueEvents` after its write commits; the delivery worker sends the queued rows. The
 * payload carries ids and names only, never an issue's text: the bot reads the issue itself.
 */
import { createId } from '@paralleldrive/cuid2';
import type { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { getRequestContext } from '../../lib/request-context';
import { formatIssueKey } from '../../utils/issue-key';
import { logger } from '../../utils/logger';
import { isAssignableBot } from '../issues/issue-references';

export type BotEventType =
  | 'issue.assigned'
  | 'issue.unassigned'
  | 'issue.commented'
  | 'issue.status_changed'
  | 'issue.edited';

export interface IssueChange {
  issueId: string;
  /** Defaults to getRequestContext()?.userId; null means SYSTEM */
  actorId?: string | null;
  assignee?: { from: string | null; to: string | null };
  status?: { fromColumnId: string | null; toColumnId: string };
  /** Issue field names, sorted; assignee and status are never in it */
  changedFields?: string[];
  commentId?: string;
}

/** A bot with this many events still pending gets no more until some are sent */
export const MAX_PENDING_PER_BOT = 1000;

type ActorKind = 'PERSON' | 'SERVICE' | 'SYSTEM';

interface Target {
  botId: string;
  type: BotEventType;
}

/**
 * Queue the bot events one issue change causes. Never throws: a failure is logged and the write
 * that called it stands.
 * @param change - What changed on the issue, and who changed it
 */
export async function emitIssueEvents(change: IssueChange): Promise<void> {
  try {
    await emit(change);
  } catch (err) {
    logger.error('Failed to queue bot events', { issueId: change.issueId }, err as Error);
  }
}

/**
 * The events a change sends, before any target is checked. An assignment change sends only
 * assignment events; otherwise the current assignee hears of status, field and comment changes.
 * @param change - The change
 * @param assigneeId - The issue's assignee after the write
 */
function targetsOf(change: IssueChange, assigneeId: string | null): Target[] {
  const { assignee } = change;
  if (assignee && assignee.from !== assignee.to) {
    const targets: Target[] = [];
    if (assignee.from) targets.push({ botId: assignee.from, type: 'issue.unassigned' });
    if (assignee.to) targets.push({ botId: assignee.to, type: 'issue.assigned' });
    return targets;
  }
  if (!assigneeId) return [];
  const targets: Target[] = [];
  if (change.status && change.status.fromColumnId !== change.status.toColumnId) {
    targets.push({ botId: assigneeId, type: 'issue.status_changed' });
  }
  if (change.changedFields && change.changedFields.length > 0) {
    targets.push({ botId: assigneeId, type: 'issue.edited' });
  }
  if (change.commentId) targets.push({ botId: assigneeId, type: 'issue.commented' });
  return targets;
}

async function actorKindOf(actorId: string | null): Promise<ActorKind> {
  if (!actorId) return 'SYSTEM';
  const user = await prisma.user.findUnique({ where: { id: actorId }, select: { kind: true } });
  if (user?.kind === 'PERSON') return 'PERSON';
  if (user?.kind === 'SERVICE') return 'SERVICE';
  return 'SYSTEM';
}

/**
 * Whether a bot gets an event now: not its own act, an active MEMBER of the issue's team, with a
 * webhook, and below the pending cap.
 * @param botId - The target bot
 * @param projectId - The issue's project
 * @param actorId - Who made the change
 */
async function accepts(botId: string, projectId: string, actorId: string | null): Promise<boolean> {
  if (botId === actorId) return false;
  if (!(await isAssignableBot(botId, projectId))) return false;
  const webhook = await prisma.botWebhook.findUnique({ where: { botId }, select: { id: true } });
  if (!webhook) return false;
  const pending = await prisma.botEvent.count({ where: { botId, status: 'PENDING' } });
  if (pending >= MAX_PENDING_PER_BOT) {
    logger.warn('Bot event dropped: too many pending', { botId, pending });
    return false;
  }
  return true;
}

async function emit(change: IssueChange): Promise<void> {
  const actorId =
    change.actorId !== undefined ? change.actorId : (getRequestContext()?.userId ?? null);
  const issue = await prisma.issue.findUnique({
    where: { id: change.issueId },
    select: {
      id: true,
      number: true,
      assigneeId: true,
      projectId: true,
      project: {
        select: {
          id: true,
          prefix: true,
          team: { select: { org: { select: { id: true, slug: true } } } },
        },
      },
    },
  });
  if (!issue) return;

  const targets = targetsOf(change, issue.assigneeId);
  if (targets.length === 0) return;

  const accepted: Target[] = [];
  const verdicts = new Map<string, boolean>();
  for (const target of targets) {
    let ok = verdicts.get(target.botId);
    if (ok === undefined) {
      ok = await accepts(target.botId, issue.projectId, actorId);
      verdicts.set(target.botId, ok);
    }
    if (ok) accepted.push(target);
  }
  if (accepted.length === 0) return;

  const actor = { id: actorId, kind: await actorKindOf(actorId) };
  let status: { from: string | null; to: string } | undefined;
  if (change.status && accepted.some((t) => t.type === 'issue.status_changed')) {
    const ids = [change.status.fromColumnId, change.status.toColumnId].filter(
      (id): id is string => !!id,
    );
    const columns = await prisma.boardColumn.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const nameOf = (id: string | null) =>
      id ? (columns.find((c) => c.id === id)?.name ?? null) : null;
    status = {
      from: nameOf(change.status.fromColumnId),
      to: nameOf(change.status.toColumnId) ?? '',
    };
  }

  const createdAt = new Date();
  const rows = accepted.map((target) => {
    const id = createId();
    const payload: Record<string, unknown> = {
      id,
      type: target.type,
      createdAt: createdAt.toISOString(),
      org: { id: issue.project.team.org.id, slug: issue.project.team.org.slug },
      project: { id: issue.project.id, key: issue.project.prefix },
      issue: { id: issue.id, key: formatIssueKey(issue.project.prefix, issue.number) },
      actor,
    };
    if (target.type === 'issue.edited') {
      payload.changes = { fields: [...(change.changedFields ?? [])].sort() };
    }
    if (target.type === 'issue.status_changed') payload.status = status;
    if (target.type === 'issue.commented') payload.comment = { id: change.commentId };
    return {
      id,
      botId: target.botId,
      type: target.type,
      payload: payload as Prisma.InputJsonObject,
      createdAt,
    };
  });
  await prisma.botEvent.createMany({ data: rows });
}
