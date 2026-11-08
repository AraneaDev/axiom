/**
 * The reads behind item.read. Everything here runs after resolveKey said the caller may open the
 * item itself. These query directly instead of through hydrateIssueDetail and hydrateWikiPage:
 * those load every comment and every version body and fan out to data no include asks for, and
 * this runs for up to 50 keys in a call. Each include is one bounded query, and each row is mapped
 * to the stable shape, so a column added to a table reaches no caller by itself.
 */
import type { Prisma } from '@prisma/client';
import { MemoryStore, type Options } from 'express-rate-limit';

import { prisma } from '../config/database';
import { createUserSlots } from '../lib/user-slots';
import { AppError } from '../middleware/errorHandler';
import { checkProjectAccess } from '../middleware/requireProjectAccess';
import { scopeAllows, type ScopeArea } from '../middleware/token-scopes';
import {
  CHECKS_LIMIT,
  createGithubReadCache,
  DEVELOPMENT_LIMIT,
  type GithubReadCache,
  loadChecks,
  loadDevelopment,
} from '../modules/github/github-reads';
import { formatIssueKey } from '../utils/issue-key';
import { logger } from '../utils/logger';
import { PROJECT_URL_SELECT, SPACE_URL_SELECT } from '../utils/prisma-selects';

import { isToken } from './approval-policy';
import type { ActionContext } from './define';
import {
  createViewer,
  keyIdentity,
  keyNotFound,
  parseKey,
  resolveKey,
  type ResolvedKey,
  type Viewer,
} from './keys';

export const ISSUE_INCLUDES = [
  'comments',
  'links',
  'webLinks',
  'attachments',
  'history',
  'worklogs',
  'children',
  'pages',
  'development',
  'checks',
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
  development: DEVELOPMENT_LIMIT,
  checks: CHECKS_LIMIT,
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
  'externalAuthorLogin',
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

/** The most one call returns. Items past it answer 413 RESPONSE_TOO_LARGE and aren't loaded. */
export const RESPONSE_BYTE_LIMIT = 10 * 1024 * 1024;

/**
 * Keys per user per minute, however they are divided over calls: a key is what costs queries. It
 * is counted in readItems, so every way in to the action shares this limit.
 */
export const READ_LIMIT = { windowMs: 60_000, maxKeys: 300 } as const;

/**
 * Reads running at once, in this process. Ten of the largest reads together take about 700 MB,
 * and the API container has 512 MB. It refuses rather than queues, so that slow reads can't build
 * up. The keys per minute above say nothing about this: they all fit in a few calls.
 */
export const READ_CONCURRENCY = { perUser: 4, total: 16 } as const;
export const readSlots = createUserSlots(READ_CONCURRENCY.perUser, READ_CONCURRENCY.total);

export const READS_BUSY = new AppError(
  429,
  'Too many reads running, please try again shortly',
  'RATE_LIMITED',
  {
    retryAfterSeconds: 2,
  },
);

const readHits = new MemoryStore();
readHits.init({ windowMs: READ_LIMIT.windowMs } as Options);

/** Keys of free-form activity details that never leave, whatever a future writer puts there. */
const PRIVATE_DETAIL = /email|secret|token|hash|storagekey|password/i;
/** Details about files, for a reader whose token doesn't hold files:read. */
const FILE_DETAIL = /^(fileName|attachmentId)$/;

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

/** What one call shares between its items. */
interface Reader {
  ctx: ActionContext;
  viewer: Viewer;
  commentBodies: boolean;
  budget: ReturnType<typeof createByteBudget>;
  /** What the GitHub includes looked up already in this call */
  github: GithubReadCache;
}

const githubScope = (reader: Reader, projectId: string) => ({ projectId, cache: reader.github });

function responseTooLarge(): AppError {
  return new AppError(
    413,
    'This call reached its 10 MB limit. Read this key in another call, or with fewer includes, ' +
      'fewer fields or without comment bodies',
    'RESPONSE_TOO_LARGE',
  );
}

/**
 * Counts what a call is about to return, as it is loaded: one piece at a time, so what is in
 * memory stays within the limit plus the one piece that went past it.
 * @param limit - The most bytes
 */
function createByteBudget(limit: number) {
  let spent = 0;
  return {
    /**
     * Count a piece of the response.
     * @param value - The piece
     * @throws {AppError} 413 RESPONSE_TOO_LARGE past the limit
     */
    spend(value: unknown): void {
      spent += Buffer.byteLength(JSON.stringify(value) ?? '');
      if (spent > limit) throw responseTooLarge();
    },
    exhausted: () => spent > limit,
  };
}

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
 * Free-form details without the keys the reader doesn't get.
 * @param value - A JSON value
 * @param hidden - Whether a key stays out
 */
function scrubDetails(value: Prisma.JsonValue, hidden: (key: string) => boolean): Prisma.JsonValue {
  if (Array.isArray(value)) return value.map((item) => scrubDetails(item, hidden));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !hidden(key))
      .map(([key, item]) => [key, scrubDetails(item as Prisma.JsonValue, hidden)]),
  );
}

/**
 * The pages of an issue: its link rows, which every writer of a page body keeps up to date, for
 * the pages the reader can view.
 * @param issue - The issue
 * @param reader - Who reads
 */
async function issuePages(issue: IssueRef, reader: Reader) {
  const limit = ISSUE_INCLUDE_LIMITS.pages;
  // A page holds at most one row per link type, so this always reaches past the cap
  const rows = await prisma.wikiPageIssueLink.findMany({
    where: { issueId: issue.id, page: await reader.viewer.pages() },
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
  return capped(
    [...linked.values()].map(({ row, linkTypes }) => ({ ...pageSummary(row), linkTypes })),
    limit,
  );
}

/** What the includes of an issue need to know of it. */
interface IssueRef {
  id: string;
  projectId: string;
}

const ISSUE_INCLUDE_LOADERS: {
  [K in IssueInclude]: (issue: IssueRef, reader: Reader) => Promise<unknown>;
} = {
  comments: async ({ id }, reader) => {
    // The newest ones, in reading order
    const limit = ISSUE_INCLUDE_LIMITS.comments;
    const rows = await prisma.comment.findMany({
      where: { issueId: id },
      select: {
        id: true,
        body: reader.commentBodies,
        createdAt: true,
        updatedAt: true,
        author: { select: USER_REF_SELECT },
        externalAuthorLogin: true,
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
  links: async ({ id }, reader) => {
    const limit = ISSUE_INCLUDE_LIMITS.links;
    const other = await reader.viewer.issues();
    // A link counts only when the reader can open the issue at its other end
    const rows = await prisma.issueLink.findMany({
      where: {
        OR: [
          { fromId: id, to: other },
          { toId: id, from: other },
        ],
      },
      select: { id: true, type: true, fromId: true, toId: true },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
    });
    // In a second step: Prisma runs every nested select, also for an issue without links
    const ends = rows.length
      ? await prisma.issue.findMany({
          where: { id: { in: rows.map((row) => (row.fromId === id ? row.toId : row.fromId)) } },
          select: ISSUE_SUMMARY_SELECT,
        })
      : [];
    const endById = new Map(ends.map((end) => [end.id, end]));
    return capped(
      rows.flatMap((row) => {
        const end = endById.get(row.fromId === id ? row.toId : row.fromId);
        if (!end) return [];
        return [
          {
            id: row.id,
            type: row.type,
            direction: row.fromId === id ? 'outward' : 'inward',
            issue: issueSummary(end),
          },
        ];
      }),
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
  history: async ({ id }, reader) => {
    const limit = ISSUE_INCLUDE_LIMITS.history;
    const hideFiles = !coversArea(reader.ctx, 'files');
    const hidden = (key: string) =>
      PRIVATE_DETAIL.test(key) || (hideFiles && FILE_DETAIL.test(key));
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
        details: row.details === null ? null : scrubDetails(row.details, hidden),
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
  children: async ({ id }, reader) => {
    const limit = ISSUE_INCLUDE_LIMITS.children;
    const rows = await prisma.issue.findMany({
      where: { parentId: id, AND: [await reader.viewer.issues()] },
      select: ISSUE_SUMMARY_SELECT,
      orderBy: { number: 'asc' },
      take: limit + 1,
    });
    return capped(rows.map(issueSummary), limit);
  },
  pages: (issue, reader) => issuePages(issue, reader),
  development: ({ id, projectId }, reader) =>
    loadDevelopment(id, ISSUE_INCLUDE_LIMITS.development, githubScope(reader, projectId)),
  checks: ({ id, projectId }, reader) =>
    loadChecks(id, ISSUE_INCLUDE_LIMITS.checks, githubScope(reader, projectId)),
};

const PAGE_INCLUDE_LOADERS: {
  [K in PageInclude]: (pageId: string, reader: Reader) => Promise<unknown>;
} = {
  children: async (pageId, reader) => {
    const limit = PAGE_INCLUDE_LIMITS.children;
    const rows = await prisma.page.findMany({
      where: { parentId: pageId, AND: [await reader.viewer.pages()] },
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
  linkedIssues: async (pageId, reader) => {
    const limit = PAGE_INCLUDE_LIMITS.linkedIssues;
    // An issue holds at most one row per link type, so this always reaches past the cap
    const rows = await prisma.wikiPageIssueLink.findMany({
      where: { pageId, issue: await reader.viewer.issues() },
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
  comments: async (pageId, reader) => {
    const limit = PAGE_INCLUDE_LIMITS.comments;
    const rows = await prisma.pageComment.findMany({
      where: { pageId },
      select: {
        id: true,
        body: reader.commentBodies,
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
  development: 'github',
  checks: 'github',
};

/**
 * Whether the caller's scopes cover reading an area. A session has no scopes to check.
 * @param ctx - Who reads
 * @param area - The area
 */
export function coversArea(ctx: ActionContext, area: ScopeArea): boolean {
  return !isToken(ctx) || scopeAllows(ctx.scopes ?? [], area, 'read');
}

/**
 * Load what was asked of the includes that apply to this kind of item, as fields of its data, one
 * after the other so the budget can stop in between. An include for the other kind is passed over:
 * one call can hold issues and pages.
 * @param reader - Who reads
 * @param include - What was asked
 * @param loaders - The loaders of this kind of item
 * @param load - Runs a loader
 */
async function loadIncludes<K extends ReadInclude>(
  reader: Reader,
  include: readonly ReadInclude[],
  loaders: Record<K, unknown>,
  load: (name: K) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const applicable = [...new Set(include)].filter((name): name is K => name in loaders);
  const covered = (name: K) => {
    const area = INCLUDE_AREA[name];
    return !area || coversArea(reader.ctx, area);
  };
  const result: Record<string, unknown> = {};
  for (const name of applicable.filter(covered)) {
    const value = await load(name);
    reader.budget.spend(value);
    result[name] = value;
  }
  const omitted = applicable.filter((name) => !covered(name));
  if (omitted.length > 0) result.omittedIncludes = omitted;
  return result;
}

/**
 * Keep the fields asked for. Without a list, all of them.
 * @param base - The base item
 * @param fields - The fields asked for
 */
export function pickFields<T extends { id: string; key: string }>(
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
  /** False leaves the bodies of comments out */
  commentBodies?: boolean;
}

/**
 * Read one issue.
 * @param reader - Who reads
 * @param resolved - Its ids, from resolveKey
 * @param resolved.projectId
 * @param resolved.issueNumber
 * @param options - What to return
 */
async function readIssue(
  reader: Reader,
  resolved: { projectId: string; issueNumber: number },
  options: ReadOptions,
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
      externalAuthorLogin: true,
      labels: { select: { id: true, name: true } },
      sprint: { select: { id: true, name: true } },
      parentId: true,
      project: { select: { id: true, name: true, ...PROJECT_URL_SELECT } },
    },
  });
  if (!issue) throw keyNotFound();

  // A parent elsewhere shows only to who can open that project
  const parent = issue.parentId
    ? await prisma.issue.findUnique({
        where: { id: issue.parentId },
        select: { ...ISSUE_SUMMARY_SELECT, projectId: true },
      })
    : null;
  const parentVisible =
    parent &&
    (parent.projectId === resolved.projectId ||
      (await checkProjectAccess(reader.ctx.userId, parent.projectId)) === 'ok');

  const summary = issueSummary(issue);
  const base = {
    ...summary,
    number: issue.number,
    body: issue.body,
    type: issue.type,
    priority: issue.priority,
    assignee: issue.assignee,
    creator: issue.creator,
    /** The GitHub login of an imported issue's author, when the creator is the integration user */
    externalAuthorLogin: issue.externalAuthorLogin,
    labels: issue.labels,
    sprint: issue.sprint,
    parent: parent && parentVisible ? issueSummary(parent) : null,
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

  const picked = pickFields(base, options.fields);
  reader.budget.spend(picked);
  const includes = await loadIncludes(
    reader,
    options.include ?? [],
    ISSUE_INCLUDE_LOADERS,
    (name: IssueInclude) =>
      ISSUE_INCLUDE_LOADERS[name]({ id: issue.id, projectId: resolved.projectId }, reader),
  );
  return { ...picked, ...includes };
}

/**
 * Read one page.
 * @param reader - Who reads
 * @param resolved - Its ids, from resolveKey
 * @param resolved.spaceId
 * @param resolved.pageSlug
 * @param options - What to return
 */
async function readPage(
  reader: Reader,
  resolved: { spaceId: string; pageSlug: string },
  options: ReadOptions,
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
  const picked = pickFields(base, options.fields);
  reader.budget.spend(picked);
  const includes = await loadIncludes(
    reader,
    options.include ?? [],
    PAGE_INCLUDE_LOADERS,
    (name: PageInclude) => PAGE_INCLUDE_LOADERS[name](page.id, reader),
  );
  return { ...picked, ...includes };
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
 * @param reader - Who reads
 * @param key - The key
 * @param options - What to return
 */
async function readItem(reader: Reader, key: string, options: ReadOptions) {
  try {
    const { kind } = parseKey(key);
    if (!coversArea(reader.ctx, kind === 'issue' ? 'issues' : 'wiki')) {
      throw new AppError(403, 'This API token does not have the scope for this item', 'SCOPE');
    }
    const resolved: ResolvedKey = await resolveKey(key, reader.ctx.userId, reader.viewer);
    return resolved.kind === 'issue'
      ? { key, kind: resolved.kind, data: await readIssue(reader, resolved, options) }
      : { key, kind: resolved.kind, data: await readPage(reader, resolved, options) };
  } catch (err) {
    return itemError(key, err);
  }
}

/**
 * Count keys against the user's limit.
 * @param userId - The user
 * @param count - How many keys
 * @throws {AppError} 429 RATE_LIMITED past the limit
 */
async function assertReadWithinLimit(userId: string, count: number): Promise<void> {
  let totalHits = 0;
  for (let i = 0; i < count; i++) ({ totalHits } = await readHits.increment(userId));
  if (totalHits > READ_LIMIT.maxKeys) {
    throw new AppError(429, 'Too many keys read, please try again later', 'RATE_LIMITED');
  }
}

/**
 * Read items by key, one at a time so that one call holds a single connection and stops loading
 * when its budget runs out. Spellings of one key (AXM-042, a URL with a query) are read and
 * answered once, under the first.
 * @param ctx - Who reads
 * @param keys - The keys
 * @param options - What to return for each
 * @throws {AppError} 429 RATE_LIMITED past READ_LIMIT or READ_CONCURRENCY
 */
export async function readItems(ctx: ActionContext, keys: string[], options: ReadOptions) {
  const unique = new Map<string, string>();
  for (const key of keys) {
    const identity = keyIdentity(key);
    if (!unique.has(identity)) unique.set(identity, key);
  }
  return readSlots.run(ctx.userId, READS_BUSY, async () => {
    await assertReadWithinLimit(ctx.userId, unique.size);

    const reader: Reader = {
      ctx,
      viewer: createViewer(ctx.userId),
      commentBodies: options.commentBodies ?? true,
      budget: createByteBudget(RESPONSE_BYTE_LIMIT),
      github: createGithubReadCache(),
    };
    const items = [];
    for (const key of unique.values()) {
      items.push(
        reader.budget.exhausted()
          ? itemError(key, responseTooLarge())
          : await readItem(reader, key, options),
      );
    }
    return { items, byteLimit: RESPONSE_BYTE_LIMIT, truncated: reader.budget.exhausted() };
  });
}
