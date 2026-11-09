/**
 * Where an action acts (decision 11): the teams, spaces and pages its input touches, read from the
 * database. A bot's request is shown and offered only to owners who can open every part of it.
 * Every write a token can reach declares a `place` resolver from here, or `orgLevel: true`; a
 * resolver that finds nothing leaves a request nobody may decide, never one anybody may.
 */
import { prisma } from '../config/database';

import type { ActionContext } from './define';
import { resolveKey } from './keys';

/** What a resolver finds. orgLevel without ids: no team, space or page, any owner decides. */
export interface PlaceRefs {
  teamIds?: string[];
  spaceIds?: string[];
  pageIds?: string[];
  orgLevel?: boolean;
}

export type PlaceResolver = (ctx: ActionContext, input: unknown) => Promise<PlaceRefs>;

/**
 * The fields of an input, or none.
 * @param input - A validated input
 */
function fieldsOf(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

/**
 * Every id of some fields, as strings.
 * @param given - The input's fields
 * @param fields - The field names
 */
function idsOf(given: Record<string, unknown>, ...fields: string[]): string[] {
  return fields.flatMap((field) => {
    const value = given[field];
    if (typeof value === 'string' && value) return [value];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item !== '')
      : [];
  });
}

/**
 * The teams of some projects.
 * @param ids - Project ids
 */
async function teamsOfProjects(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.project.findMany({
    where: { id: { in: ids } },
    select: { teamId: true },
  });
  return rows.map((r) => r.teamId);
}

/**
 * The teams of some issues.
 * @param ids - Issue ids
 */
async function teamsOfIssues(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.issue.findMany({
    where: { id: { in: ids } },
    select: { project: { select: { teamId: true } } },
  });
  return rows.map((r) => r.project.teamId);
}

/**
 * The page a space and a slug name, or the space when no such page is there (a page about to be
 * made under that slug acts in the space).
 * @param spaceId - The space
 * @param pageSlug - The slug
 */
async function pageBySlug(spaceId: string, pageSlug: string): Promise<PlaceRefs> {
  const page = await prisma.page.findFirst({
    where: { spaceId, slug: pageSlug },
    select: { id: true },
  });
  return page ? { pageIds: [page.id] } : { spaceIds: [spaceId] };
}

/**
 * Several finds as one.
 * @param parts - The finds
 */
function joined(...parts: PlaceRefs[]): PlaceRefs {
  return {
    teamIds: parts.flatMap((p) => p.teamIds ?? []),
    spaceIds: parts.flatMap((p) => p.spaceIds ?? []),
    pageIds: parts.flatMap((p) => p.pageIds ?? []),
    orgLevel: parts.some((p) => p.orgLevel),
  };
}

/**
 * Whether a find names no team, space or page.
 * @param place - The find
 */
export function isEmptyPlace(place: PlaceRefs): boolean {
  return !place.teamIds?.length && !place.spaceIds?.length && !place.pageIds?.length;
}

/** An action that acts on no team, space or page: any owner decides. */
export const orgLevelPlace: PlaceResolver = () => Promise.resolve({ orgLevel: true });

/**
 * The place of the ids an input names, as authorize reads them:
 * - teams: teamId, and the team of projectId, targetProjectId, issueId(s) and sprintId;
 * - spaces: spaceId (the page, when a pageSlug names one), targetSpaceId, releaseNotesSpaceId;
 * - pages: pageId, parentId, targetParentId.
 * @param _ctx - Who runs it
 * @param input - Its validated input
 */
export const inputPlace: PlaceResolver = async (_ctx, input) => {
  const given = fieldsOf(input);
  const sprintIds = idsOf(given, 'sprintId');
  const [projectTeams, issueTeams, sprints, slugPlace] = await Promise.all([
    teamsOfProjects(idsOf(given, 'projectId', 'targetProjectId')),
    teamsOfIssues(idsOf(given, 'issueId', 'issueIds')),
    sprintIds.length
      ? prisma.sprint.findMany({
          where: { id: { in: sprintIds } },
          select: { project: { select: { teamId: true } } },
        })
      : [],
    typeof given.spaceId === 'string' && typeof given.pageSlug === 'string'
      ? pageBySlug(given.spaceId, given.pageSlug)
      : Promise.resolve<PlaceRefs>({ spaceIds: idsOf(given, 'spaceId') }),
  ]);
  return joined(
    {
      teamIds: [...idsOf(given, 'teamId'), ...projectTeams, ...issueTeams],
      spaceIds: idsOf(given, 'targetSpaceId', 'releaseNotesSpaceId'),
      pageIds: idsOf(given, 'pageId', 'parentId', 'targetParentId'),
    },
    { teamIds: sprints.map((s) => s.project.teamId) },
    slugPlace,
  );
};

/**
 * The team of the project only: for forms, whose pageId names a form page, not a wiki page.
 * @param _ctx - Who runs it
 * @param input - Its validated input
 */
export const projectPlace: PlaceResolver = async (_ctx, input) => ({
  teamIds: await teamsOfProjects(idsOf(fieldsOf(input), 'projectId')),
});

/**
 * The place of the input, or org level when it names none: for something made unshared or for
 * the whole org (an invitation without a team, a private dashboard or query).
 * @param ctx - Who runs it
 * @param input - Its validated input
 */
export const inputOrOrgPlace: PlaceResolver = async (ctx, input) => {
  const place = await inputPlace(ctx, input);
  return isEmptyPlace(place) ? { orgLevel: true } : place;
};

/**
 * A wiki comment, by its id: its page.
 * @param _ctx - Who runs it
 * @param input - Its validated input, with commentId
 */
export const pageCommentPlace: PlaceResolver = async (_ctx, input) => {
  const [commentId] = idsOf(fieldsOf(input), 'commentId');
  const row = commentId
    ? await prisma.pageComment.findUnique({ where: { id: commentId }, select: { pageId: true } })
    : null;
  return { pageIds: row ? [row.pageId] : [] };
};

/**
 * A page restriction, by its id: its page.
 * @param _ctx - Who runs it
 * @param input - Its validated input, with restrictionId
 */
export const pageRestrictionPlace: PlaceResolver = async (_ctx, input) => {
  const [restrictionId] = idsOf(fieldsOf(input), 'restrictionId');
  const row = restrictionId
    ? await prisma.pageRestriction.findUnique({
        where: { id: restrictionId },
        select: { pageId: true },
      })
    : null;
  return { pageIds: row ? [row.pageId] : [] };
};

/**
 * A page template, by its id: its space.
 * @param _ctx - Who runs it
 * @param input - Its validated input, with templateId
 */
export const pageTemplatePlace: PlaceResolver = async (_ctx, input) => {
  const [templateId] = idsOf(fieldsOf(input), 'templateId');
  const row = templateId
    ? await prisma.pageTemplate.findUnique({ where: { id: templateId }, select: { spaceId: true } })
    : null;
  return { spaceIds: row ? [row.spaceId] : [] };
};

/**
 * The context a template resolves in: its space and its project.
 * @param ctx - Who runs it
 * @param input - Its validated input, with context
 */
export const templateContextPlace: PlaceResolver = (ctx, input) =>
  inputPlace(ctx, fieldsOf(fieldsOf(input).context));

/**
 * A milestone, by its id: the team of its project.
 * @param _ctx - Who runs it
 * @param input - Its validated input, with milestoneId
 */
export const milestonePlace: PlaceResolver = async (_ctx, input) => {
  const [milestoneId] = idsOf(fieldsOf(input), 'milestoneId');
  const row = milestoneId
    ? await prisma.milestone.findUnique({ where: { id: milestoneId }, select: { projectId: true } })
    : null;
  return { teamIds: await teamsOfProjects(row ? [row.projectId] : []) };
};

/**
 * A custom field, by its id: the team of its project.
 * @param _ctx - Who runs it
 * @param input - Its validated input, with fieldId
 */
export const customFieldPlace: PlaceResolver = async (_ctx, input) => {
  const [fieldId] = idsOf(fieldsOf(input), 'fieldId');
  const row = fieldId
    ? await prisma.customFieldDefinition.findUnique({
        where: { id: fieldId },
        select: { projectId: true },
      })
    : null;
  return { teamIds: await teamsOfProjects(row ? [row.projectId] : []) };
};

/**
 * An issue approval request, by its id: the team of its issue.
 * @param _ctx - Who runs it
 * @param input - Its validated input, with requestId
 */
export const approvalRequestPlace: PlaceResolver = async (_ctx, input) => {
  const [requestId] = idsOf(fieldsOf(input), 'requestId');
  const row = requestId
    ? await prisma.approvalRequest.findUnique({
        where: { id: requestId },
        select: { issueId: true },
      })
    : null;
  return { teamIds: await teamsOfIssues(row ? [row.issueId] : []) };
};

/**
 * The parent of an attachment: its issue, its page, or the issue of its comment.
 * @param parent - The parent ids
 * @param parent.issueId
 * @param parent.pageId
 * @param parent.commentId
 */
async function attachmentParentPlace(parent: {
  issueId?: string | null;
  pageId?: string | null;
  commentId?: string | null;
}): Promise<PlaceRefs> {
  const comment = parent.commentId
    ? await prisma.comment.findUnique({
        where: { id: parent.commentId },
        select: { issueId: true },
      })
    : null;
  const issueIds = [parent.issueId, comment?.issueId].filter((id): id is string => !!id);
  return {
    teamIds: await teamsOfIssues(issueIds),
    pageIds: parent.pageId ? [parent.pageId] : [],
  };
}

/**
 * A stored attachment, by its id: its parent.
 * @param _ctx - Who runs it
 * @param input - Its validated input, with id
 */
export const attachmentPlace: PlaceResolver = async (_ctx, input) => {
  const [id] = idsOf(fieldsOf(input), 'id');
  const row = id
    ? await prisma.attachment.findUnique({
        where: { id },
        select: { issueId: true, pageId: true, commentId: true },
      })
    : null;
  return row ? attachmentParentPlace(row) : {};
};

/**
 * The parent a multipart upload names.
 * @param _ctx - Who runs it
 * @param input - Its validated fields: issueId, pageId, commentId
 */
export const uploadFieldsPlace: PlaceResolver = async (_ctx, input) => {
  const given = fieldsOf(input);
  const place = await attachmentParentPlace({
    issueId: idsOf(given, 'issueId')[0],
    pageId: idsOf(given, 'pageId')[0],
    commentId: idsOf(given, 'commentId')[0],
  });
  return isEmptyPlace(place) ? { orgLevel: true } : place;
};

/**
 * Where a new file goes: an issue or a page, by ids or by key. A staged file, with no target, is
 * org level: it acts where it is attached later, and that call has a place of its own.
 * @param ctx - Who runs it
 * @param input - Its validated input, with target
 */
export const uploadTargetPlace: PlaceResolver = async (ctx, input) => {
  const target = fieldsOf(fieldsOf(input).target);
  if (Object.keys(target).length === 0) return { orgLevel: true };
  if (typeof target.issueKey === 'string' || typeof target.pageKey === 'string') {
    const key = (target.issueKey ?? target.pageKey) as string;
    const resolved = await resolveKey(key, ctx.userId);
    return resolved.kind === 'issue'
      ? { teamIds: await teamsOfProjects([resolved.projectId]) }
      : pageBySlug(resolved.spaceId, resolved.pageSlug);
  }
  return inputPlace(ctx, target);
};

/**
 * A shared record (a dashboard or a saved query) as stored, and as the input reshares it: the
 * team it is shared with, the team of its project, or org level when it is private or shared with
 * the whole org.
 * @param stored - The stored row, if any
 * @param stored.visibility
 * @param stored.teamId
 * @param stored.projectId
 * @param given - The input's fields
 */
async function sharedPlace(
  stored: { visibility: string; teamId: string | null; projectId?: string | null } | null,
  given: Record<string, unknown>,
): Promise<PlaceRefs> {
  const teamIds = [
    ...(stored?.visibility === 'TEAM' && stored.teamId ? [stored.teamId] : []),
    ...(given.visibility === 'TEAM' ? idsOf(given, 'teamId') : []),
    ...(await teamsOfProjects(stored?.projectId ? [stored.projectId] : [])),
  ];
  return teamIds.length > 0 ? { teamIds } : { orgLevel: true };
}

/**
 * A dashboard, by its id, as stored and as resharing it would leave it.
 * @param _ctx - Who runs it
 * @param input - Its validated input, with id
 */
export const dashboardPlace: PlaceResolver = async (_ctx, input) => {
  const given = fieldsOf(input);
  const [id] = idsOf(given, 'id');
  const row = id
    ? await prisma.dashboard.findUnique({
        where: { id },
        select: { visibility: true, teamId: true },
      })
    : null;
  if (!row) return {};
  return sharedPlace(row, given);
};

/**
 * A saved query, by its id, as stored and as resharing it would leave it.
 * @param _ctx - Who runs it
 * @param input - Its validated input, with filterId
 */
export const savedQueryPlace: PlaceResolver = async (_ctx, input) => {
  const given = fieldsOf(input);
  const [filterId] = idsOf(given, 'filterId');
  const row = filterId
    ? await prisma.savedFilter.findUnique({
        where: { id: filterId },
        select: { visibility: true, teamId: true, projectId: true },
      })
    : null;
  if (!row) return {};
  return sharedPlace(row, given);
};

/**
 * A dashboard widget: the dashboard, and the saved query the widget names, as stored. The query
 * runs with the bot's rights when the dashboard renders, so who decides must be able to open it
 * too. A query or a dashboard that names nothing leaves a request nobody decides.
 * @param ctx - Who runs it
 * @param input - Its validated input, with id and savedQueryId
 */
export const dashboardWidgetPlace: PlaceResolver = async (ctx, input) => {
  const dashboard = await dashboardPlace(ctx, input);
  const [savedQueryId] = idsOf(fieldsOf(input), 'savedQueryId');
  if (!savedQueryId || (isEmptyPlace(dashboard) && !dashboard.orgLevel)) return dashboard;
  const row = await prisma.savedFilter.findUnique({
    where: { id: savedQueryId },
    select: { visibility: true, teamId: true, projectId: true },
  });
  if (!row) return {};
  return joined(dashboard, await sharedPlace(row, {}));
};
