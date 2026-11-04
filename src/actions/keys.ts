/**
 * Names for issues and pages that people and agents already hold: AXM-42, org/team/AXM-42,
 * org/team/space/page-slug and the URLs the app shows. Parsing fetches nothing and looks at no
 * host. Whatever the caller can't see answers exactly like what doesn't exist, so a key never
 * tells who else has what.
 */
import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { assertPageAccess } from '../middleware/rbac';
import { checkProjectAccess } from '../middleware/requireProjectAccess';
import { parseAxiomUrl } from '../modules/links/resolve-link.service';
import { viewableProjectsWhere } from '../modules/search/search-access';
import { formatIssueKey } from '../utils/issue-key';
import { PROJECT_URL_SELECT } from '../utils/prisma-selects';

export const MAX_KEY_LENGTH = 512;

/** The largest value of the issue number column */
const MAX_ISSUE_NUMBER = 2147483647;
/** How many candidates an ambiguous key lists */
const MAX_CANDIDATES = 20;

const ISSUE_KEY = /^([A-Z][A-Z0-9]*)-(\d+)$/;
const CONTROL_CHARACTER = /\p{Cc}/u;

export type ResolvedKey =
  | { kind: 'issue'; projectId: string; issueNumber: number }
  | { kind: 'page'; spaceId: string; pageSlug: string };

interface ParsedPageKey {
  kind: 'page';
  org: string;
  team: string;
  space: string;
  slug: string;
}

type ParsedIssueKey = {
  kind: 'issue';
  /** Digits as given: they may not fit a number */
  number: string;
} & (
  | { prefix: string; org?: undefined; team?: undefined; projectSlug?: undefined }
  | { prefix: string; org: string; team: string; projectSlug?: undefined }
  | { prefix?: undefined; org: string; team: string; projectSlug: string }
);

export type ParsedKey = ParsedIssueKey | ParsedPageKey;

/** The one answer for nothing there and nothing the caller may see. */
export function keyNotFound(): AppError {
  return new AppError(404, 'Nothing found for this key', 'NOT_FOUND');
}

function invalidKey(): AppError {
  return new AppError(
    400,
    'A key is AXM-42, org/team/AXM-42, org/team/space/page-slug or the URL of an issue or page',
    'INVALID_KEY',
  );
}

/**
 * Read a URL or a site path, by the path alone.
 * @param key - The URL, or a path from the site root
 * @throws {AppError} 400 when it is not the path of an issue or a page
 */
function parseUrlKey(key: string): ParsedKey {
  const path = key.startsWith('/') ? key.split(/[?#]/, 1)[0] : pathOf(key);
  const parsed = parseAxiomUrl(path.replace(/\/+$/, ''));
  if (!parsed) throw invalidKey();
  const { org, team, target, identifier } = parsed;
  if (parsed.type === 'wiki') return { kind: 'page', org, team, space: target, slug: identifier };
  // The app's own routes rank the literal wiki segment first, so this path shows a page
  if (target === 'wiki') return { kind: 'page', org, team, space: 'issues', slug: identifier };
  return { kind: 'issue', org, team, projectSlug: target, number: identifier };
}

/**
 * The path of a full URL. The host is ignored on purpose.
 * @param url - An http or https URL
 * @throws {AppError} 400 when it can't be parsed
 */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    throw invalidKey();
  }
}

/**
 * What a key names, from its text alone: nothing is looked up, so this can't tell what exists.
 * @param key - The key as given
 * @throws {AppError} 400 INVALID_KEY when it has none of the accepted forms
 */
export function parseKey(key: string): ParsedKey {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH || CONTROL_CHARACTER.test(key)) {
    throw invalidKey();
  }
  if (key.startsWith('/') || /^https?:\/\//.test(key)) {
    return parseUrlKey(key);
  }
  const segments = key.split('/');
  if (segments.some((segment) => segment === '')) throw invalidKey();
  if (segments.length === 4) {
    const [org, team, space, slug] = segments;
    return { kind: 'page', org, team, space, slug };
  }
  if (segments.length !== 1 && segments.length !== 3) throw invalidKey();
  const match = ISSUE_KEY.exec(segments[segments.length - 1]);
  if (!match) throw invalidKey();
  const [, prefix, number] = match;
  if (segments.length === 1) return { kind: 'issue', prefix, number };
  return { kind: 'issue', org: segments[0], team: segments[1], prefix, number };
}

/**
 * The project an issue key points into, among what the user can open.
 * @param parsed - The parsed key
 * @param issueNumber - The issue's number, for the candidates
 * @param userId - Who asks
 * @throws {AppError} 404 for no such project, 409 AMBIGUOUS_KEY for a bare prefix that several
 * visible teams use
 */
async function resolveProjectId(
  parsed: ParsedIssueKey,
  issueNumber: number,
  userId: string,
): Promise<string> {
  if (parsed.org === undefined) {
    const projects = await prisma.project.findMany({
      where: { prefix: parsed.prefix, AND: [await viewableProjectsWhere(userId)] },
      select: { id: true, ...PROJECT_URL_SELECT },
      orderBy: { id: 'asc' },
      take: MAX_CANDIDATES,
    });
    if (projects.length === 0) throw keyNotFound();
    if (projects.length > 1) {
      const candidates = projects.map(
        (project) =>
          `${project.team.org.slug}/${project.team.slug}/${formatIssueKey(project.prefix, issueNumber)}`,
      );
      throw new AppError(
        409,
        `This key matches projects in more than one team: ${candidates.join(', ')}`,
        'AMBIGUOUS_KEY',
        { candidates },
      );
    }
    return projects[0].id;
  }
  const project = await prisma.project.findFirst({
    where: {
      team: { slug: parsed.team, org: { slug: parsed.org } },
      ...(parsed.projectSlug === undefined
        ? { prefix: parsed.prefix }
        : { slug: parsed.projectSlug }),
    },
    select: { id: true },
  });
  if (!project || (await checkProjectAccess(userId, project.id)) !== 'ok') throw keyNotFound();
  return project.id;
}

/**
 * Find an issue by key, for someone who may open it.
 * @param parsed - The parsed key
 * @param userId - Who asks
 */
async function resolveIssueKey(parsed: ParsedIssueKey, userId: string): Promise<ResolvedKey> {
  const issueNumber = Number(parsed.number);
  if (issueNumber > MAX_ISSUE_NUMBER) throw keyNotFound();
  const projectId = await resolveProjectId(parsed, issueNumber, userId);
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
    select: { id: true },
  });
  if (!issue) throw keyNotFound();
  return { kind: 'issue', projectId, issueNumber };
}

/**
 * Find a page by key, for someone who may view it: assertPageAccess, the rule of every page route.
 * @param parsed - The parsed key
 * @param userId - Who asks
 */
async function resolvePageKey(parsed: ParsedPageKey, userId: string): Promise<ResolvedKey> {
  const page = await prisma.page.findFirst({
    where: {
      slug: parsed.slug,
      space: { slug: parsed.space, team: { slug: parsed.team, org: { slug: parsed.org } } },
    },
    select: { id: true, spaceId: true, slug: true },
  });
  if (!page) throw keyNotFound();
  try {
    await assertPageAccess(userId, page.id, 'view');
  } catch (err) {
    if (err instanceof AppError) throw keyNotFound();
    throw err;
  }
  return { kind: 'page', spaceId: page.spaceId, pageSlug: page.slug };
}

/**
 * Turn a key into the ids the services take. What it returns, the user may open.
 * @param key - AXM-42, org/team/AXM-42, org/team/space/page-slug or a URL of an issue or page
 * @param userId - Who asks
 * @throws {AppError} 400 INVALID_KEY for no accepted form, 404 for nothing the user can see (never
 * 403), 409 AMBIGUOUS_KEY with details.candidates for a bare prefix several visible teams use
 */
export async function resolveKey(key: string, userId: string): Promise<ResolvedKey> {
  const parsed = parseKey(key);
  return parsed.kind === 'page' ? resolvePageKey(parsed, userId) : resolveIssueKey(parsed, userId);
}
