import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { parse, compileToPrisma } from '../../lib/query-engine';
import { issueFieldRegistry } from '../../lib/query-engine/fields/issue-fields';
import { formatIssueKey } from '../../utils/issue-key';
import {
  PROJECT_URL_WITH_NAME_SELECT,
  SPACE_URL_SELECT,
  USER_WITH_AVATAR_SELECT,
} from '../../utils/prisma-selects';

import {
  viewableIssuesWhere,
  viewablePageIdFilter,
  viewablePagesWhere,
  viewableProjectIds,
} from './search-access';

// ─── Types ──────────────────────────────────────────────────

export interface SearchParams {
  q: string;
  type: 'issues' | 'wiki' | 'all';
  teamId?: string;
  projectId?: string;
  spaceId?: string;
  label?: string;
  since?: string;
  until?: string;
  limit: number;
  offset: number;
  userId?: string;
}

interface StructuredQuery {
  freeText: string;
  filters: Record<string, string>;
}

export interface SearchResultSection {
  type: string;
  items: unknown[];
  total: number;
}

// ─── Structured Query Parsing ───────────────────────────────

const STRUCTURED_FIELDS = new Set([
  'type',
  'status',
  'priority',
  'assignee',
  'label',
  'project',
  'author',
]);

/**
 * Parse a query string like "type:bug status:open fix login" into structured filters and remaining free text.
 * @param raw - The raw query string to parse
 * @returns Parsed query with freeText and structured filters map
 */
export function parseStructuredQuery(raw: string): StructuredQuery {
  const filters: Record<string, string> = {};
  const freeTextParts: string[] = [];

  const tokens = raw.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  for (const token of tokens) {
    const colonIdx = token.indexOf(':');
    if (colonIdx > 0) {
      const field = token.substring(0, colonIdx).toLowerCase();
      const value = token.substring(colonIdx + 1).replace(/^"|"$/g, '');
      if (STRUCTURED_FIELDS.has(field) && value) {
        filters[field] = value;
        continue;
      }
    }
    freeTextParts.push(token);
  }

  return { freeText: freeTextParts.join(' '), filters };
}

/**
 * Convert a free-text string into a PostgreSQL tsquery-safe string with prefix matching on the last word.
 * @param text - The free-text search string
 * @returns A tsquery-formatted string or empty string if no valid words
 */
function toTsQuery(text: string): string {
  const words = text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((w) => w.length > 0);
  if (words.length === 0) return '';
  // Prefix-match on last word for autocomplete-style search
  return words.map((w, i) => (i === words.length - 1 ? `${w}:*` : w)).join(' & ');
}

// ─── Issue Search (FTS + Structured Filters) ────────────────

/**
 *
 * @param freeText
 * @param filters
 * @param params
 * @param rawQuery
 */
export async function searchIssues(
  freeText: string,
  filters: Record<string, string>,
  params: SearchParams,
  rawQuery?: string,
) {
  const where: Prisma.IssueWhereInput = {};
  // Only issues the searcher could open. Without a searcher there is nothing to show: an
  // empty filter would search every org. The access clause is kept apart from the search
  // filters, so "no text and no filters" can still be told apart.
  if (!params.userId) return { type: 'issues', items: [], total: 0 };
  const accessClause = await viewableIssuesWhere(params.userId);
  const andClauses: Prisma.IssueWhereInput[] = [];

  if (params.projectId) {
    where.projectId = params.projectId;
  }

  // Try query engine for structured queries
  let usedQueryEngine = false;
  if (rawQuery && /[=><!]|(?:^|\s)(?:AND|OR|NOT|IN)(?:\s|$)|\w+:/.test(rawQuery)) {
    try {
      const ast = parse(rawQuery);
      const engineWhere = compileToPrisma(ast, issueFieldRegistry, {
        projectId: params.projectId,
      });
      // Merge engine-generated clauses into AND
      if (Object.keys(engineWhere).length > 0) {
        andClauses.push(engineWhere as Prisma.IssueWhereInput);
        usedQueryEngine = true;
      }
    } catch {
      // Fall through to legacy structured filter parsing below
    }
  }

  // Legacy structured filter parsing (used as fallback or when no structured syntax)
  if (!usedQueryEngine) {
    if (filters.type) {
      const issueType = filters.type.toUpperCase();
      if (['TASK', 'BUG', 'STORY', 'EPIC'].includes(issueType)) {
        andClauses.push({ type: issueType as 'TASK' | 'BUG' | 'STORY' | 'EPIC' });
      }
    }

    if (filters.priority) {
      const priority = filters.priority.toUpperCase();
      if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(priority)) {
        andClauses.push({ priority: priority as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' });
      }
    }

    if (filters.assignee) {
      andClauses.push({
        assignee: {
          OR: [
            { username: { equals: filters.assignee, mode: 'insensitive' } },
            { displayName: { contains: filters.assignee, mode: 'insensitive' } },
          ],
        },
      });
    }

    if (filters.status) {
      andClauses.push({
        column: { name: { equals: filters.status, mode: 'insensitive' } },
      });
    }

    if (filters.label) {
      andClauses.push({
        labels: { some: { name: { equals: filters.label, mode: 'insensitive' } } },
      });
    }

    if (filters.project) {
      andClauses.push({
        project: {
          OR: [
            { slug: { equals: filters.project, mode: 'insensitive' } },
            { prefix: { equals: filters.project.toUpperCase() } },
          ],
        },
      });
    }
  }

  where.AND = [accessClause, ...andClauses];

  const tsq = toTsQuery(freeText);
  const useFts = tsq.length > 0;

  // If we have free text, use PostgreSQL full-text search via $queryRaw for ranking
  if (useFts) {
    try {
      // Rank only what the searcher can open: a global top-N filtered afterwards can leave
      // nothing of theirs
      const projectIds = await viewableProjectIds(params.userId);
      const rawIssues = await prisma.$queryRaw<
        Array<{
          id: string;
          rank: number;
        }>
      >`
        SELECT id, ts_rank(
          to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')),
          to_tsquery('english', ${tsq})
        ) AS rank
        FROM issues
        WHERE to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
          @@ to_tsquery('english', ${tsq})
          ${projectIds === null ? Prisma.empty : Prisma.sql`AND "projectId" = ANY(${projectIds})`}
        ORDER BY rank DESC
        LIMIT ${params.limit + 50}
      `;

      const ftsIds = rawIssues.map((r: { id: string; rank: number }) => r.id);
      if (ftsIds.length === 0) {
        // FTS found nothing -- fall back to LIKE search
        where.OR = [
          { title: { contains: freeText, mode: 'insensitive' } },
          { body: { contains: freeText, mode: 'insensitive' } },
        ];
      } else {
        where.id = { in: ftsIds };
      }
    } catch {
      // Fallback to LIKE search if FTS fails (e.g., invalid query)
      where.OR = [
        { title: { contains: freeText, mode: 'insensitive' } },
        { body: { contains: freeText, mode: 'insensitive' } },
      ];
    }
  } else if (!andClauses.length) {
    // No text and no filters -- nothing to search
    return { type: 'issues', items: [], total: 0 };
  }

  const [issues, total] = await Promise.all([
    prisma.issue.findMany({
      where,
      include: {
        project: { select: PROJECT_URL_WITH_NAME_SELECT },
        assignee: { select: USER_WITH_AVATAR_SELECT },
        labels: true,
        column: { select: { name: true, isDone: true } },
      },
      take: params.limit,
      skip: params.offset,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.issue.count({ where }),
  ]);

  return {
    type: 'issues',
    total,
    items: issues.map((i: (typeof issues)[number]) => ({
      ...i,
      key: formatIssueKey(i.project.prefix, i.number),
      url: `/${i.project.team.org.slug}/${i.project.team.slug}/${i.project.slug}/issues/${i.number}`,
      projectName: i.project.name,
      status: i.column?.name ?? 'Backlog',
    })),
  };
}

// ─── Wiki Search (FTS) ──────────────────────────────────────

const WIKI_RESULT_INCLUDE = {
  space: { select: SPACE_URL_SELECT },
  pageLabels: true,
} satisfies Prisma.PageInclude;

type WikiResultRow = Prisma.PageGetPayload<{ include: typeof WIKI_RESULT_INCLUDE }>;

/**
 * A page as a wiki search result.
 * @param page - The page
 * @param snippet - The matching text, when the search has it
 */
function wikiResultItem(page: WikiResultRow, snippet: string) {
  return {
    ...page,
    url: `/${page.space.team.org.slug}/${page.space.team.slug}/wiki/${page.space.slug}/${page.slug}`,
    spaceName: page.space.name,
    spaceId: page.spaceId,
    labels: page.pageLabels.map((l: { label: string }) => l.label),
    snippet,
  };
}

/**
 * Pages with exactly this title, whatever its case, that the user could open. Full-text ranking
 * can't promise these: it stems words, drops punctuation and cuts off by rank.
 * @param title - The title
 * @param userId - Who searches
 * @param limit - The most to return
 */
export async function pagesByExactTitle(title: string, userId: string, limit: number) {
  const pages = await prisma.page.findMany({
    where: {
      title: { equals: title, mode: 'insensitive' },
      AND: [await viewablePagesWhere(userId)],
    },
    include: WIKI_RESULT_INCLUDE,
    take: limit,
    orderBy: { updatedAt: 'desc' },
  });
  return pages.map((page) => wikiResultItem(page, ''));
}

/**
 *
 * @param freeText
 * @param _filters
 * @param params
 */
export async function searchWiki(
  freeText: string,
  _filters: Record<string, string>,
  params: SearchParams,
) {
  // Allow wiki search with filters even if no free text
  const hasFilters = !!(params.spaceId || params.label || params.since || params.until);
  if (!freeText && !hasFilters) {
    return { type: 'wiki', items: [], total: 0 };
  }

  const tsq = toTsQuery(freeText);
  if (!params.userId) return { type: 'wiki', items: [], total: 0 };
  // Only pages the searcher could open; a space filter narrows within that
  const where: Prisma.PageWhereInput = {
    AND: [
      await viewablePagesWhere(params.userId),
      ...(params.spaceId ? [{ spaceId: params.spaceId }] : []),
    ],
  };

  // Label filter
  if (params.label) {
    where.pageLabels = {
      some: { label: { equals: params.label, mode: 'insensitive' } },
    };
  }

  // Date range filters on updatedAt
  if (params.since || params.until) {
    const updatedAt: Prisma.DateTimeFilter = {};
    if (params.since) updatedAt.gte = new Date(params.since);
    if (params.until) updatedAt.lte = new Date(params.until);
    where.updatedAt = updatedAt;
  }

  if (tsq) {
    try {
      // Rank only pages the searcher can open (see the issue search)
      const { spaceIds, hiddenPageIds } = await viewablePageIdFilter(params.userId);
      const rawPages = await prisma.$queryRaw<
        Array<{
          id: string;
          rank: number;
          snippet: string;
        }>
      >`
        SELECT id, ts_rank(
          to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')),
          to_tsquery('english', ${tsq})
        ) AS rank,
        ts_headline('english', body, to_tsquery('english', ${tsq}),
          'MaxWords=30, MinWords=15, StartSel=<<, StopSel=>>'
        ) AS snippet
        FROM pages
        WHERE to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
          @@ to_tsquery('english', ${tsq})
          AND "spaceId" = ANY(${spaceIds})
          AND NOT (id = ANY(${hiddenPageIds}))
        ORDER BY rank DESC
        LIMIT ${params.limit + 20}
      `;

      if (rawPages.length === 0) {
        return { type: 'wiki', items: [], total: 0 };
      }

      const snippetMap = new Map(
        rawPages.map((r: { id: string; snippet: string }) => [r.id, r.snippet]),
      );
      where.id = { in: rawPages.map((r: { id: string }) => r.id) };

      const [pages, total] = await Promise.all([
        prisma.page.findMany({
          where,
          include: WIKI_RESULT_INCLUDE,
          take: params.limit,
          skip: params.offset,
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.page.count({ where }),
      ]);

      return {
        type: 'wiki',
        total,
        items: pages.map((p) => wikiResultItem(p, snippetMap.get(p.id) ?? '')),
      };
    } catch {
      // Fallback
    }
  }

  // Fallback to LIKE search (only if we have free text)
  if (freeText) {
    where.OR = [
      { title: { contains: freeText, mode: 'insensitive' } },
      { body: { contains: freeText, mode: 'insensitive' } },
    ];
  }

  const [pages, total] = await Promise.all([
    prisma.page.findMany({
      where,
      include: WIKI_RESULT_INCLUDE,
      take: params.limit,
      skip: params.offset,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.page.count({ where }),
  ]);

  return {
    type: 'wiki',
    total,
    items: pages.map((p) => wikiResultItem(p, '')),
  };
}
