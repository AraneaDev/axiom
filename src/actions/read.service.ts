/**
 * The reads behind item.read. Everything here runs after resolveKey said the caller may open the
 * item itself. These query directly instead of through hydrateIssueDetail and hydrateWikiPage:
 * those load every comment and every version body and fan out to data no include asks for, and
 * this runs for up to 50 keys in a call. Each include is one bounded query, and each row is mapped
 * to the stable shape, so a column added to a table reaches no caller by itself.
 */
import type { Prisma } from '@prisma/client';

import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { checkProjectAccess } from '../middleware/requireProjectAccess';
import { scopeAllows, type ScopeArea } from '../middleware/token-scopes';
import {
  viewableIssuesWhere,
  viewablePageIdFilter,
  viewablePagesWhere,
} from '../modules/search/search-access';
import { formatIssueKey } from '../utils/issue-key';
import { logger } from '../utils/logger';
import { PROJECT_URL_SELECT, SPACE_URL_SELECT, TEAM_ORG_SELECT } from '../utils/prisma-selects';

import type { ActionContext } from './define';
import { isToken } from './execute';
import { keyNotFound, parseKey, resolveKey, type ResolvedKey } from './keys';

export const ISSUE_INCLUDES = [
  'comments',
  'links',
  'webLinks',
  'attachments',
  'history',
  'worklogs',
  'children',
  'pages',
] as const;
export const PAGE_INCLUDES = [
  'children',
  'attachments',
  'history',
  'labels',
  'linkedIssues',
  'comments',
] as const;
export type IssueInclude = (typeof ISSUE_INCLUDES)[number];
export type PageInclude = (typeof PAGE_INCLUDES)[number];
export type ReadInclude = IssueInclude | PageInclude;

/** The most each include returns per item. Past it the include says `truncated: true`. */
export const ISSUE_INCLUDE_LIMITS: Record<IssueInclude, number> = {
  comments: 100,
  links: 100,
  webLinks: 50,
  attachments: 50,
  history: 50,
  worklogs: 100,
  children: 100,
  pages: 20,
};
export const PAGE_INCLUDE_LIMITS: Record<PageInclude, number> = {
  children: 100,
  attachments: 50,
  history: 50,
  labels: 100,
  linkedIssues: 50,
  comments: 100,
};

/** Fields `fields` can name. id and key always come along. */
export const ISSUE_FIELDS = [
  'fullKey',
  'url',
  'number',
  'title',
  'body',
  'type',
  'priority',
  'status',
  'assignee',
  'creator',
  'labels',
  'sprint',
  'parent',
  'project',
  'storyPoints',
  'dueDate',
  'startDate',
  'timeEstimate',
  'timeSpent',
  'createdAt',
  'updatedAt',
] as const;
export const PAGE_FIELDS = [
  'url',
  'slug',
  'title',
  'body',
  'isDraft',
  'parentId',
  'space',
  'version',
  'lastEditedBy',
  'createdAt',
  'updatedAt',
] as const;
export type ReadField = (typeof ISSUE_FIELDS)[number] | (typeof PAGE_FIELDS)[number];

/** How many items are read at the same time, so one call can't take the whole connection pool. */
const ITEMS_AT_ONCE = 5;

/** Keys of free-form activity details that never leave, whatever a future writer puts there. */
const PRIVATE_DETAIL = /email|secret|token|hash|storagekey|password/i;

const USER_REF_SELECT = { id: true, displayName: true } as const;

const ISSUE_SUMMARY_SELECT = {
  id: true,
  number: true,
  title: true,
  column: { select: { name: true } },
  project: { select: PROJECT_URL_SELECT },
} satisfies Prisma.IssueSelect;

const PAGE_SUMMARY_SELECT = {
  id: true,
  title: true,
  slug: true,
  space: { select: SPACE_URL_SELECT },
} satisfies Prisma.PageSelect;

const ATTACHMENT_SELECT = {
  id: true,
  originalName: true,
  mimeType: true,
  size: true,
  createdAt: true,
  uploader: { select: USER_REF_SELECT },
} satisfies Prisma.AttachmentSelect;

type IssueSummaryRow = Prisma.IssueGetPayload<{ select: typeof ISSUE_SUMMARY_SELECT }>;
type PageSummaryRow = Prisma.PageGetPayload<{ select: typeof PAGE_SUMMARY_SELECT }>;
type AttachmentRow = Prisma.AttachmentGetPayload<{ select: typeof ATTACHMENT_SELECT }>;

/**
 * The filters of one call. They take several queries each and hold for the whole call.
 * @param userId - The reader
 */
function visibilityFor(userId: string) {
  const once = <T>(load: () => Promise<T>) => {
    let loaded: Promise<T> | undefined;
    return () => (loaded ??= load());
  };
  return {
    issues: once(() => viewableIssuesWhere(userId)),
    pages: once(() => viewablePagesWhere(userId)),
    pageIds: once(() => viewablePageIdFilter(userId)),
  };
}
type Visibility = ReturnType<typeof visibilityFor>;

/**
 * Rows fetched with one more than the limit, as an include.
 * @param rows - At most limit + 1 rows
 * @param limit - The cap
 */
function capped<T>(rows: T[], limit: number) {
  return { items: rows.slice(0, limit), limit, truncated: rows.length > limit };
}

function issueSummary(row: IssueSummaryRow) {
  const { team, prefix, slug } = row.project;
  const key = formatIssueKey(prefix, row.number);
  return {
    id: row.id,
    key,
    fullKey: `${team.org.slug}/${team.slug}/${key}`,
    url: `/${team.org.slug}/${team.slug}/${slug}/issues/${row.number}`,
    title: row.title,
    status: row.column?.name ?? null,
  };
}

function pageSummary(row: PageSummaryRow) {
  const { team, slug: space } = row.space;
  return {
    id: row.id,
    key: `${team.org.slug}/${team.slug}/${space}/${row.slug}`,
    url: `/${team.org.slug}/${team.slug}/wiki/${space}/${row.slug}`,
    title: row.title,
    slug: row.slug,
  };
}

function attachmentItem(row: AttachmentRow) {
  return {
    id: row.id,
    name: row.originalName,
    mimeType: row.mimeType,
    size: row.size,
    url: `/api/attachments/${row.id}`,
    uploader: row.uploader,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Free-form details without the keys that never leave.
 * @param value - A JSON value
 */
function scrubDetails(value: Prisma.JsonValue): Prisma.JsonValue {
  if (Array.isArray(value)) return value.map(scrubDetails);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_DETAIL.test(key))
      .map(([key, item]) => [key, scrubDetails(item as Prisma.JsonValue)]),
  );
}

/**
 * The pages of an issue: linked ones (a row per page and link type), then the pages whose body
 * mentions the key that have no row, as after a save from the collaborative editor. That scan runs
 * only over the spaces the reader can view in the issue's org, the org a mention resolves in, and
 * with a word boundary so AXM-4 does not match AXM-42.
 * @param issue - The issue
 * @param issue.id
 * @param issue.key
 * @param issue.orgId
 * @param visible - The reader's filters
 */
async function issuePages(issue: IssueRef, visible: Visibility) {
  const limit = ISSUE_INCLUDE_LIMITS.pages;
  // A page holds at most one row per link type, so this always reaches past the cap
  const rows = await prisma.wikiPageIssueLink.findMany({
    where: { issueId: issue.id, page: await visible.pages() },
    select: { linkType: true, page: { select: PAGE_SUMMARY_SELECT } },
    orderBy: { createdAt: 'desc' },
    take: (limit + 1) * 2,
  });
  const linked = new Map<string, { row: PageSummaryRow; linkTypes: string[] }>();
  for (const { page, linkType } of rows) {
    const entry = linked.get(page.id) ?? { row: page, linkTypes: [] };
    entry.linkTypes.push(linkType);
    linked.set(page.id, entry);
  }

  const missing = limit + 1 - linked.size;
  const mentioned: PageSummaryRow[] = [];
  if (missing > 0) {
    const { spaceIds, hiddenPageIds } = await visible.pageIds();
    const inOrg = await prisma.wikiSpace.findMany({
      where: { id: { in: spaceIds }, team: { orgId: issue.orgId } },
      select: { id: true },
    });
    if (inOrg.length > 0) {
      const skip = [...hiddenPageIds, ...linked.keys()];
      const pattern = `\\y${issue.key.replace(/[^A-Za-z0-9-]/g, '')}\\y`;
      const found = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM pages
        WHERE "spaceId" = ANY(${inOrg.map((space) => space.id)})
          AND NOT (id = ANY(${skip}))
          AND body ~ ${pattern}
        ORDER BY "updatedAt" DESC
        LIMIT ${missing}
      `;
      mentioned.push(
        ...(await prisma.page.findMany({
          where: { id: { in: found.map((page) => page.id) } },
          select: PAGE_SUMMARY_SELECT,
        })),
      );
    }
  }
  return capped(
    [
      ...[...linked.values()].map(({ row, linkTypes }) => ({ ...pageSummary(row), linkTypes })),
      ...mentioned.map((row) => ({ ...pageSummary(row), linkTypes: ['MENTION'] })),
    ],
    limit,
  );
}

/** What the includes of an issue need to know of it. */
interface IssueRef {
  id: string;
  key: string;
  orgId: string;
}

const ISSUE_INCLUDE_LOADERS: {
  [K in IssueInclude]: (issue: IssueRef, visible: Visibility) => Promise<unknown>;
} = {
  comments: async ({ id }) => {
    // The newest ones, in reading order
    const limit = ISSUE_INCLUDE_LIMITS.comments;
    const rows = await prisma.comment.findMany({
      where: { issueId: id },
      select: {
        id: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        author: { select: USER_REF_SELECT },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const { items, truncated } = capped(rows, limit);
    return {
      items: items.reverse().map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      limit,
      truncated,
    };
  },
  links: async ({ id }, visible) => {
    const limit = ISSUE_INCLUDE_LIMITS.links;
    const other = await visible.issues();
    // A link counts only when the reader can open the issue at its other end
    const rows = await prisma.issueLink.findMany({
      where: {
        OR: [
          { fromId: id, to: other },
          { toId: id, from: other },
        ],
      },
      select: {
        id: true,
        type: true,
        fromId: true,
        from: { select: ISSUE_SUMMARY_SELECT },
        to: { select: ISSUE_SUMMARY_SELECT },
      },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
    });
    return capped(
      rows.map((row) => ({
        id: row.id,
        type: row.type,
        direction: row.fromId === id ? 'outward' : 'inward',
        issue: issueSummary(row.fromId === id ? row.to : row.from),
      })),
      limit,
    );
  },
  webLinks: async ({ id }) => {
    const limit = ISSUE_INCLUDE_LIMITS.webLinks;
    const rows = await prisma.issueWebLink.findMany({
      where: { issueId: id },
      select: {
        id: true,
        url: true,
        title: true,
        createdAt: true,
        createdBy: { select: USER_REF_SELECT },
      },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
    });
    return capped(
      rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      limit,
    );
  },
  attachments: async ({ id }) => {
    const limit = ISSUE_INCLUDE_LIMITS.attachments;
    const rows = await prisma.attachment.findMany({
      where: { issueId: id },
      select: ATTACHMENT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    return capped(rows.map(attachmentItem), limit);
  },
  history: async ({ id }) => {
    const limit = ISSUE_INCLUDE_LIMITS.history;
    const rows = await prisma.activity.findMany({
      where: { resourceType: 'issue', resourceId: id },
      select: {
        id: true,
        action: true,
        details: true,
        via: true,
        createdAt: true,
        user: { select: USER_REF_SELECT },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    return capped(
      rows.map((row) => ({
        id: row.id,
        action: row.action,
        details: row.details === null ? null : scrubDetails(row.details),
        via: row.via,
        actor: row.user,
        createdAt: row.createdAt.toISOString(),
      })),
      limit,
    );
  },
  worklogs: async ({ id }) => {
    const limit = ISSUE_INCLUDE_LIMITS.worklogs;
    const rows = await prisma.timeEntry.findMany({
      where: { issueId: id },
      select: {
        id: true,
        minutes: true,
        description: true,
        loggedAt: true,
        user: { select: USER_REF_SELECT },
      },
      orderBy: { loggedAt: 'desc' },
      take: limit + 1,
    });
    return capped(
      rows.map((row) => ({ ...row, loggedAt: row.loggedAt.toISOString() })),
      limit,
    );
  },
  children: async ({ id }, visible) => {
    const limit = ISSUE_INCLUDE_LIMITS.children;
    const rows = await prisma.issue.findMany({
      where: { parentId: id, AND: [await visible.issues()] },
      select: ISSUE_SUMMARY_SELECT,
      orderBy: { number: 'asc' },
      take: limit + 1,
    });
    return capped(rows.map(issueSummary), limit);
  },
  pages: (issue, visible) => issuePages(issue, visible),
};

const PAGE_INCLUDE_LOADERS: {
  [K in PageInclude]: (pageId: string, visible: Visibility) => Promise<unknown>;
} = {
  children: async (pageId, visible) => {
    const limit = PAGE_INCLUDE_LIMITS.children;
    const rows = await prisma.page.findMany({
      where: { parentId: pageId, AND: [await visible.pages()] },
      select: PAGE_SUMMARY_SELECT,
      orderBy: { position: 'asc' },
      take: limit + 1,
    });
    return capped(rows.map(pageSummary), limit);
  },
  attachments: async (pageId) => {
    const limit = PAGE_INCLUDE_LIMITS.attachments;
    const rows = await prisma.attachment.findMany({
      where: { pageId },
      select: ATTACHMENT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    return capped(rows.map(attachmentItem), limit);
  },
  history: async (pageId) => {
    const limit = PAGE_INCLUDE_LIMITS.history;
    // Without the bodies, which can be large: this says what changed, when and by whom
    const rows = await prisma.pageVersion.findMany({
      where: { pageId },
      select: {
        id: true,
        version: true,
        title: true,
        changeDescription: true,
        kind: true,
        createdAt: true,
        author: { select: USER_REF_SELECT },
      },
      orderBy: { version: 'desc' },
      take: limit + 1,
    });
    return capped(
      rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      limit,
    );
  },
  labels: async (pageId) => {
    const limit = PAGE_INCLUDE_LIMITS.labels;
    const rows = await prisma.pageLabel.findMany({
      where: { pageId },
      select: { label: true },
      orderBy: { label: 'asc' },
      take: limit + 1,
    });
    return capped(
      rows.map((row) => row.label),
      limit,
    );
  },
  linkedIssues: async (pageId, visible) => {
    const limit = PAGE_INCLUDE_LIMITS.linkedIssues;
    // An issue holds at most one row per link type, so this always reaches past the cap
    const rows = await prisma.wikiPageIssueLink.findMany({
      where: { pageId, issue: await visible.issues() },
      select: { linkType: true, issue: { select: ISSUE_SUMMARY_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: (limit + 1) * 2,
    });
    const linked = new Map<string, { row: IssueSummaryRow; linkTypes: string[] }>();
    for (const { issue, linkType } of rows) {
      const entry = linked.get(issue.id) ?? { row: issue, linkTypes: [] };
      entry.linkTypes.push(linkType);
      linked.set(issue.id, entry);
    }
    return capped(
      [...linked.values()].map(({ row, linkTypes }) => ({ issue: issueSummary(row), linkTypes })),
      limit,
    );
  },
  comments: async (pageId) => {
    const limit = PAGE_INCLUDE_LIMITS.comments;
    const rows = await prisma.pageComment.findMany({
      where: { pageId },
      select: {
        id: true,
        body: true,
        anchorText: true,
        resolved: true,
        createdAt: true,
        user: { select: USER_REF_SELECT },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const { items, truncated } = capped(rows, limit);
    return {
      items: items.reverse().map(({ user, ...row }) => ({
        ...row,
        author: user,
        createdAt: row.createdAt.toISOString(),
      })),
      limit,
      truncated,
    };
  },
};

/** The scope an include needs beyond the one of its item: it shows another area's data. */
const INCLUDE_AREA: Partial<Record<ReadInclude, ScopeArea>> = {
  attachments: 'files',
  pages: 'wiki',
  linkedIssues: 'issues',
};

/**
 * Whether the caller's scopes cover reading an area. A session has no scopes to check.
 * @param ctx - Who reads
 * @param area - The area
 */
function coversArea(ctx: ActionContext, area: ScopeArea): boolean {
  return !isToken(ctx) || scopeAllows(ctx.scopes ?? [], area, 'read');
}

/**
 * Load what was asked of the includes that apply to this kind of item, as fields of its data. An
 * include for the other kind is passed over: one call can hold issues and pages.
 * @param ctx - Who reads
 * @param include - What was asked
 * @param loaders - The loaders of this kind of item
 * @param load - Runs a loader
 */
async function loadIncludes<K extends ReadInclude>(
  ctx: ActionContext,
  include: readonly ReadInclude[],
  loaders: Record<K, unknown>,
  load: (name: K) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const applicable = [...new Set(include)].filter((name): name is K => name in loaders);
  const covered = (name: K) => {
    const area = INCLUDE_AREA[name];
    return !area || coversArea(ctx, area);
  };
  const allowed = applicable.filter(covered);
  const omitted = applicable.filter((name) => !covered(name));
  const loaded = await Promise.all(allowed.map(async (name) => [name, await load(name)]));
  return {
    ...Object.fromEntries(loaded),
    ...(omitted.length > 0 ? { omittedIncludes: omitted } : {}),
  };
}

/**
 * Keep the fields asked for. Without a list, all of them.
 * @param base - The base item
 * @param fields - The fields asked for
 */
function pickFields<T extends { id: string; key: string }>(
  base: T,
  fields: readonly ReadField[] | undefined,
): Partial<T> & { id: string; key: string } {
  if (!fields) return base;
  const picked = { id: base.id, key: base.key } as Partial<T> & { id: string; key: string };
  for (const field of fields) {
    if (field in base) Object.assign(picked, { [field]: base[field as keyof T] });
  }
  return picked;
}

/** What a read asks for, apart from its keys. */
interface ReadOptions {
  include?: ReadInclude[];
  fields?: ReadField[];
}

/**
 * Read one issue.
 * @param ctx - Who reads
 * @param resolved - Its ids, from resolveKey
 * @param resolved.projectId
 * @param resolved.issueNumber
 * @param options - What to return
 * @param visible - The reader's filters
 */
async function readIssue(
  ctx: ActionContext,
  resolved: { projectId: string; issueNumber: number },
  options: ReadOptions,
  visible: Visibility,
) {
  const issue = await prisma.issue.findUnique({
    where: {
      projectId_number: { projectId: resolved.projectId, number: resolved.issueNumber },
    },
    select: {
      ...ISSUE_SUMMARY_SELECT,
      body: true,
      type: true,
      priority: true,
      storyPoints: true,
      dueDate: true,
      startDate: true,
      timeEstimate: true,
      timeSpent: true,
      createdAt: true,
      updatedAt: true,
      assignee: { select: USER_REF_SELECT },
      creator: { select: USER_REF_SELECT },
      labels: { select: { id: true, name: true } },
      sprint: { select: { id: true, name: true } },
      parent: { select: { ...ISSUE_SUMMARY_SELECT, projectId: true } },
      project: {
        select: {
          id: true,
          name: true,
          ...PROJECT_URL_SELECT,
          team: { select: { orgId: true, ...TEAM_ORG_SELECT } },
        },
      },
    },
  });
  if (!issue) throw keyNotFound();

  // A parent elsewhere shows only to who can open that project
  const parentVisible =
    issue.parent &&
    (issue.parent.projectId === resolved.projectId ||
      (await checkProjectAccess(ctx.userId, issue.parent.projectId)) === 'ok');

  const summary = issueSummary(issue);
  const base = {
    ...summary,
    number: issue.number,
    body: issue.body,
    type: issue.type,
    priority: issue.priority,
    assignee: issue.assignee,
    creator: issue.creator,
    labels: issue.labels,
    sprint: issue.sprint,
    parent: issue.parent && parentVisible ? issueSummary(issue.parent) : null,
    project: {
      id: issue.project.id,
      name: issue.project.name,
      prefix: issue.project.prefix,
      slug: issue.project.slug,
    },
    storyPoints: issue.storyPoints,
    dueDate: issue.dueDate?.toISOString() ?? null,
    startDate: issue.startDate?.toISOString() ?? null,
    timeEstimate: issue.timeEstimate,
    timeSpent: issue.timeSpent,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  };

  const ref: IssueRef = { id: issue.id, key: summary.key, orgId: issue.project.team.orgId };
  const includes = await loadIncludes(
    ctx,
    options.include ?? [],
    ISSUE_INCLUDE_LOADERS,
    (name: IssueInclude) => ISSUE_INCLUDE_LOADERS[name](ref, visible),
  );
  return { ...pickFields(base, options.fields), ...includes };
}

/**
 * Read one page.
 * @param ctx - Who reads
 * @param resolved - Its ids, from resolveKey
 * @param resolved.spaceId
 * @param resolved.pageSlug
 * @param options - What to return
 * @param visible - The reader's filters
 */
async function readPage(
  ctx: ActionContext,
  resolved: { spaceId: string; pageSlug: string },
  options: ReadOptions,
  visible: Visibility,
) {
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: resolved.spaceId, slug: resolved.pageSlug } },
    select: {
      ...PAGE_SUMMARY_SELECT,
      body: true,
      isDraft: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
      versions: {
        select: { version: true, author: { select: USER_REF_SELECT } },
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  });
  if (!page) throw keyNotFound();

  const [latest] = page.versions;
  const base = {
    ...pageSummary(page),
    body: page.body,
    isDraft: page.isDraft,
    parentId: page.parentId,
    space: { id: page.space.id, name: page.space.name, slug: page.space.slug },
    version: latest?.version ?? null,
    lastEditedBy: latest?.author ?? null,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
  const includes = await loadIncludes(
    ctx,
    options.include ?? [],
    PAGE_INCLUDE_LOADERS,
    (name: PageInclude) => PAGE_INCLUDE_LOADERS[name](page.id, visible),
  );
  return { ...pickFields(base, options.fields), ...includes };
}

/**
 * What a failed item answers. An unexpected error is logged and says nothing about itself.
 * @param key - The key
 * @param err - What was thrown
 */
function itemError(key: string, err: unknown) {
  if (err instanceof AppError && err.statusCode < 500) {
    return {
      key,
      error: {
        status: err.statusCode,
        code: err.code ?? 'ERROR',
        message: err.message,
        ...(Array.isArray(err.details?.candidates)
          ? { details: { candidates: err.details.candidates as string[] } }
          : {}),
      },
    };
  }
  logger.error('item.read failed on an item', { key }, err as Error);
  return {
    key,
    error: { status: 500, code: 'INTERNAL', message: 'This item could not be read' },
  };
}

/**
 * Read one key. A failure belongs to this item only. The scope comes before any lookup, from the
 * key's text, so a token without it learns nothing about what exists.
 * @param ctx - Who reads
 * @param key - The key
 * @param options - What to return
 * @param visible - The reader's filters
 */
async function readItem(
  ctx: ActionContext,
  key: string,
  options: ReadOptions,
  visible: Visibility,
) {
  try {
    const { kind } = parseKey(key);
    if (!coversArea(ctx, kind === 'issue' ? 'issues' : 'wiki')) {
      throw new AppError(403, 'This API token does not have the scope for this item', 'SCOPE');
    }
    const resolved: ResolvedKey = await resolveKey(key, ctx.userId);
    return resolved.kind === 'issue'
      ? { key, kind: resolved.kind, data: await readIssue(ctx, resolved, options, visible) }
      : { key, kind: resolved.kind, data: await readPage(ctx, resolved, options, visible) };
  } catch (err) {
    return itemError(key, err);
  }
}

/**
 * Read items by key, a few at a time. A key given twice is read and returned once.
 * @param ctx - Who reads
 * @param keys - The keys
 * @param options - What to return for each
 */
export async function readItems(ctx: ActionContext, keys: string[], options: ReadOptions) {
  const visible = visibilityFor(ctx.userId);
  const unique = [...new Set(keys)];
  const items = [];
  for (let start = 0; start < unique.length; start += ITEMS_AT_ONCE) {
    const batch = unique.slice(start, start + ITEMS_AT_ONCE);
    items.push(...(await Promise.all(batch.map((key) => readItem(ctx, key, options, visible)))));
  }
  return { items };
}
