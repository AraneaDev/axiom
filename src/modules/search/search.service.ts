import { execFile } from 'child_process';
import { promisify } from 'util';

import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { repoExists } from '../../git/repo-manager';
import { parse, compileToPrisma } from '../../lib/query-engine';
import { issueFieldRegistry } from '../../lib/query-engine/fields/issue-fields';
import { formatIssueKey } from '../../utils/issue-key';
import { parseServicePagination } from '../../utils/pagination';
import {
  PROJECT_URL_WITH_NAME_SELECT,
  SPACE_URL_SELECT,
  TEAM_ORG_SELECT,
  USER_WITH_AVATAR_SELECT,
} from '../../utils/prisma-selects';

const execFileAsync = promisify(execFile);

// ─── Helpers ────────────────────────────────────────────────

/**
 * Get all organization IDs a user belongs to.
 * @param userId - The user ID
 * @returns Array of org IDs the user is a member of
 */
export async function getUserOrgIds(userId: string): Promise<string[]> {
  const memberships = await prisma.orgMembership.findMany({
    where: { userId },
    select: { orgId: true },
  });
  return memberships.map((m: { orgId: string }) => m.orgId);
}

// ─── Types ──────────────────────────────────────────────────

interface SearchParams {
  q: string;
  type: 'issues' | 'wiki' | 'repos' | 'code' | 'all';
  teamId?: string;
  projectId?: string;
  spaceId?: string;
  label?: string;
  since?: string;
  until?: string;
  limit: number;
  offset: number;
  userId?: string;
  orgIds?: string[];
}

interface StructuredQuery {
  freeText: string;
  filters: Record<string, string>;
}

interface CodeSearchParams {
  q: string;
  repoIds?: string;
  limit: number;
  userId?: string;
}

export interface CodeMatch {
  repoId: string;
  repoName: string;
  repoUrl: string;
  filePath: string;
  lineNumber: number;
  lineContent: string;
}

interface SearchResultSection {
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
function parseStructuredQuery(raw: string): StructuredQuery {
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

// ─── Main Search ────────────────────────────────────────────

/**
 * Perform a cross-resource search across issues, wiki pages, repos, and code.
 * @param params - Search parameters including query, type filter, team/project scope, and pagination
 * @returns Array of result sections by resource type with items and totals
 */
export async function search(params: SearchParams) {
  const { take, skip } = parseServicePagination(params);
  params = { ...params, limit: take, offset: skip };
  const { freeText, filters } = parseStructuredQuery(params.q);
  const results: SearchResultSection[] = [];

  if (params.type === 'issues' || params.type === 'all') {
    const issueResults = await searchIssues(freeText, filters, params, params.q);
    results.push(issueResults);
  }

  if (params.type === 'wiki' || params.type === 'all') {
    const wikiResults = await searchWiki(freeText, filters, params);
    results.push(wikiResults);
  }

  if (params.type === 'repos' || params.type === 'all') {
    const repoResults = await searchRepos(freeText, params);
    results.push(repoResults);
  }

  if (params.type === 'code') {
    const codeResults = await searchCode({
      q: freeText || params.q,
      limit: params.limit,
      userId: params.userId,
    });
    results.push(codeResults);
  }

  return results;
}

// ─── Issue Search (FTS + Structured Filters) ────────────────

async function searchIssues(
  freeText: string,
  filters: Record<string, string>,
  params: SearchParams,
  rawQuery?: string,
) {
  const where: Prisma.IssueWhereInput = {};
  const andClauses: Prisma.IssueWhereInput[] = [];

  if (params.orgIds && params.orgIds.length > 0) {
    where.project = { team: { orgId: { in: params.orgIds } } };
  }

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

  if (andClauses.length > 0) {
    where.AND = andClauses;
  }

  const tsq = toTsQuery(freeText);
  const useFts = tsq.length > 0;

  // If we have free text, use PostgreSQL full-text search via $queryRaw for ranking
  if (useFts) {
    try {
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

async function searchWiki(
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
  const where: Prisma.PageWhereInput = {};

  if (params.orgIds && params.orgIds.length > 0) {
    where.space = { team: { orgId: { in: params.orgIds } } };
  }

  // Space filter
  if (params.spaceId) {
    where.spaceId = params.spaceId;
  }

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
          include: {
            space: { select: SPACE_URL_SELECT },
            pageLabels: true,
          },
          take: params.limit,
          skip: params.offset,
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.page.count({ where }),
      ]);

      return {
        type: 'wiki',
        total,
        items: pages.map((p: (typeof pages)[number]) => ({
          ...p,
          url: `/${p.space.team.org.slug}/${p.space.team.slug}/wiki/${p.space.slug}/${p.slug}`,
          spaceName: p.space.name,
          spaceId: p.spaceId,
          labels: p.pageLabels.map((l: { label: string }) => l.label),
          snippet: snippetMap.get(p.id) ?? '',
        })),
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
      include: {
        space: { select: SPACE_URL_SELECT },
        pageLabels: true,
      },
      take: params.limit,
      skip: params.offset,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.page.count({ where }),
  ]);

  return {
    type: 'wiki',
    total,
    items: pages.map((p: (typeof pages)[number]) => ({
      ...p,
      url: `/${p.space.team.org.slug}/${p.space.team.slug}/wiki/${p.space.slug}/${p.slug}`,
      spaceName: p.space.name,
      spaceId: p.spaceId,
      labels: p.pageLabels.map((l: { label: string }) => l.label),
      snippet: '',
    })),
  };
}

// ─── Repo Search ────────────────────────────────────────────

async function searchRepos(freeText: string, params: SearchParams) {
  if (!freeText) {
    return { type: 'repos', items: [], total: 0 };
  }

  const where: Prisma.RepositoryWhereInput = {
    OR: [
      { name: { contains: freeText, mode: 'insensitive' } },
      { description: { contains: freeText, mode: 'insensitive' } },
    ],
    ...(params.orgIds && params.orgIds.length > 0
      ? { team: { orgId: { in: params.orgIds } } }
      : {}),
  };

  const [repos, total] = await Promise.all([
    prisma.repository.findMany({
      where,
      include: {
        team: { select: TEAM_ORG_SELECT },
      },
      take: params.limit,
      skip: params.offset,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.repository.count({ where }),
  ]);

  return {
    type: 'repos',
    total,
    items: repos.map((r: (typeof repos)[number]) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      visibility: r.visibility,
      defaultBranch: r.defaultBranch,
      url: `/${r.team.org.slug}/${r.team.slug}/repos/${r.slug}`,
      updatedAt: r.updatedAt,
    })),
  };
}

// ─── Code Search (git grep) ────────────────────────────────

const MAX_MATCHES_PER_REPO = 10;

/**
 * Search code across repositories using git grep, returning matching lines with file paths.
 * @param params - Code search parameters including query, optional repo IDs filter, and limit
 * @returns Search results with matching code lines, file paths, and line numbers
 */
export async function searchCode(
  params: CodeSearchParams,
): Promise<{ type: string; items: CodeMatch[]; total: number }> {
  const repoFilter: Prisma.RepositoryWhereInput = {};
  if (params.repoIds) {
    repoFilter.id = { in: params.repoIds.split(',').map((s) => s.trim()) };
  }
  // Scope to repos the user has access to via team membership
  if (params.userId) {
    repoFilter.team = {
      members: { some: { userId: params.userId } },
    };
  }

  const repos = await prisma.repository.findMany({
    where: repoFilter,
    include: {
      team: { select: TEAM_ORG_SELECT },
    },
    take: 20, // limit repos to search
  });

  const allMatches: CodeMatch[] = [];

  for (const repo of repos) {
    if (allMatches.length >= params.limit) break;
    if (!repo.diskPath) continue;

    const exists = await repoExists(repo.diskPath);
    if (!exists) continue;

    try {
      const remaining = Math.min(MAX_MATCHES_PER_REPO, params.limit - allMatches.length);
      const { stdout } = await execFileAsync(
        'git',
        [
          '--no-pager',
          'grep',
          '-n', // line numbers
          '-I', // skip binary files
          '--max-count',
          String(remaining),
          '-e',
          params.q,
          'HEAD',
          '--',
        ],
        {
          cwd: repo.diskPath,
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        },
      );

      const repoUrl = `/${repo.team.org.slug}/${repo.team.slug}/repos/${repo.slug}`;
      const lines = stdout.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        // Format: HEAD:path/to/file:lineNum:content
        const match = line.match(/^HEAD:(.+?):(\d+):(.*)$/);
        if (match) {
          allMatches.push({
            repoId: repo.id,
            repoName: repo.name,
            repoUrl,
            filePath: match[1],
            lineNumber: parseInt(match[2], 10),
            lineContent: match[3],
          });
        }
      }
    } catch {
      // git grep exits with 1 when no matches found -- ignore
    }
  }

  return {
    type: 'code',
    items: allMatches.slice(0, params.limit),
    total: allMatches.length,
  };
}

// ─── Accessible Spaces (for search filter UI) ───────────────

/**
 * Get all wiki spaces the user can access (via org membership).
 * @param orgIds - Organization IDs the user belongs to
 * @returns List of spaces with id, name, and slug
 */
export async function getAccessibleSpaces(orgIds: string[]) {
  if (!orgIds.length) return [];
  return prisma.wikiSpace.findMany({
    where: {
      isArchived: false,
      team: { orgId: { in: orgIds } },
    },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });
}

// ─── Saved Searches ─────────────────────────────────────────

/**
 * Create a global saved search for a user.
 * @param userId - The user ID
 * @param data - Saved search data including name and query object
 * @param data.name
 * @param data.query
 * @returns The created saved search record
 */
export async function createSavedSearch(
  userId: string,
  data: { name: string; query: Record<string, unknown> },
) {
  return prisma.savedFilter.create({
    data: {
      userId,
      name: data.name,
      query: data.query as Prisma.InputJsonValue,
      // projectId is null for global saved searches
    },
  });
}

/**
 * Get all global saved searches for a user.
 * @param userId - The user ID
 * @returns List of saved search records ordered by creation date
 */
export async function getSavedSearches(userId: string) {
  return prisma.savedFilter.findMany({
    where: {
      userId,
      projectId: null, // global saved searches only
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

/**
 * Delete a global saved search belonging to a user.
 * @param id - The saved search ID
 * @param userId - The user ID (ownership check)
 * @returns Delete result
 */
export async function deleteSavedSearch(id: string, userId: string) {
  return prisma.savedFilter.deleteMany({
    where: { id, userId, projectId: null },
  });
}
