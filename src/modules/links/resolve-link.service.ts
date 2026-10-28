import { prisma } from '../../config/database';
import { formatIssueKey } from '../../utils/issue-key';
import { PROJECT_TEAM_ORG_INCLUDE, SPACE_TEAM_ORG_INCLUDE } from '../../utils/prisma-selects';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedUrl {
  type: 'issue' | 'wiki';
  org: string;
  team: string;
  /** project slug (issues), space slug (wiki) */
  target: string;
  /** issue/PR number (string) or page slug (wiki) */
  identifier: string;
}

export interface LinkPreview {
  type: 'issue' | 'wiki';
  title: string;
  key: string;
  status: string;
  icon: string;
  url: string;
}

// ---------------------------------------------------------------------------
// URL patterns
// ---------------------------------------------------------------------------

const ISSUE_PATTERN = /^\/([^/]+)\/([^/]+)\/([^/]+)\/issues\/(\d+)$/;
const WIKI_PATTERN = /^\/([^/]+)\/([^/]+)\/wiki\/([^/]+)\/([^/]+)$/;

/**
 * Parse an Axiom URL (full or path-only) into its component parts.
 * Returns null when the path does not match any known pattern.
 * @param urlOrPath
 */
export function parseAxiomUrl(urlOrPath: string): ParsedUrl | null {
  let pathname = urlOrPath;

  // If it looks like a full URL, extract the pathname
  try {
    if (/^https?:\/\//.test(urlOrPath)) {
      pathname = new URL(urlOrPath).pathname;
    }
  } catch {
    return null;
  }

  let m: RegExpMatchArray | null;

  m = pathname.match(ISSUE_PATTERN);
  if (m) {
    return { type: 'issue', org: m[1], team: m[2], target: m[3], identifier: m[4] };
  }

  m = pathname.match(WIKI_PATTERN);
  if (m) {
    return { type: 'wiki', org: m[1], team: m[2], target: m[3], identifier: m[4] };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a parsed URL into a rich link preview by querying the database.
 * Returns null when the resource is not found.
 * @param urlOrPath
 * @param _userId
 */
export async function resolveLink(urlOrPath: string, _userId: string): Promise<LinkPreview | null> {
  const parsed = parseAxiomUrl(urlOrPath);
  if (!parsed) return null;

  switch (parsed.type) {
    case 'issue':
      return resolveIssue(parsed);
    case 'wiki':
      return resolveWiki(parsed);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Individual resolvers
// ---------------------------------------------------------------------------

async function resolveIssue(parsed: ParsedUrl): Promise<LinkPreview | null> {
  const issue = await prisma.issue.findFirst({
    where: {
      number: Number(parsed.identifier),
      project: {
        slug: parsed.target,
        team: {
          slug: parsed.team,
          org: { slug: parsed.org },
        },
      },
    },
    include: { ...PROJECT_TEAM_ORG_INCLUDE, column: true },
  });

  if (!issue) return null;

  const org = issue.project.team.org.slug;
  const team = issue.project.team.slug;
  const project = issue.project.slug;

  return {
    type: 'issue',
    title: issue.title,
    key: formatIssueKey(issue.project.prefix, issue.number),
    status: issue.column?.name ?? 'Unknown',
    icon: issue.type.toLowerCase(),
    url: `/${org}/${team}/${project}/issues/${issue.number}`,
  };
}

async function resolveWiki(parsed: ParsedUrl): Promise<LinkPreview | null> {
  const page = await prisma.page.findFirst({
    where: {
      slug: parsed.identifier,
      space: {
        slug: parsed.target,
        team: {
          slug: parsed.team,
          org: { slug: parsed.org },
        },
      },
    },
    include: SPACE_TEAM_ORG_INCLUDE,
  });

  if (!page) return null;

  const org = page.space.team.org.slug;
  const team = page.space.team.slug;
  const space = page.space.slug;

  return {
    type: 'wiki',
    title: page.title,
    key: page.space.name,
    status: page.isDraft ? 'Draft' : 'Published',
    icon: 'file-text',
    url: `/${org}/${team}/wiki/${space}/${page.slug}`,
  };
}
