/**
 * Names for issues and pages that people and agents already hold: AXM-42, org/team/AXM-42,
 * org/team/space/page-slug and the URLs the app shows. Parsing fetches nothing and looks at no
 * host. Whatever the caller can't see answers exactly like what doesn't exist, so a key never
 * tells who else has what.
 */
import type { Prisma } from '@prisma/client';

import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { checkWikiSpaceOrgAccess } from '../middleware/rbac';
import { parseAxiomUrl } from '../modules/links/resolve-link.service';
import { viewablePagesWhere, viewableProjectsWhere } from '../modules/search/search-access';
import { canAccessSpace } from '../modules/wiki/space-access';
import { formatIssueKey } from '../utils/issue-key';
import { PROJECT_URL_SELECT } from '../utils/prisma-selects';

export const MAX_KEY_LENGTH = 512;

/** The largest value of the issue number column */
const MAX_ISSUE_NUMBER = 2147483647;
/** How many candidates an ambiguous key lists */
const MAX_CANDIDATES = 20;

const ISSUE_KEY = /^([A-Z][A-Z0-9]*)-(\d+)$/;
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * What one user may see, as Prisma filters. They take several queries each and hold for one call,
 * so a call builds them once. Visibility goes into the lookups themselves: what the user can't see
 * and what doesn't exist then run the same query, so the timing doesn't tell them apart either.
 * @param userId - The user
 */
export function createViewer(userId: string) {
  const once = <T>(load: () => Promise<T>) => {
    let loaded: Promise<T> | undefined;
    return () => (loaded ??= load());
  };
  const projects = once(() => viewableProjectsWhere(userId));
  return {
    projects,
    issues: once(async (): Promise<Prisma.IssueWhereInput> => ({ project: await projects() })),
    pages: once(() => viewablePagesWhere(userId)),
    /** The visible projects with a prefix, as a call can hold many keys of one project. */
    byPrefix: new Map<string, Promise<PrefixMatch[]>>(),
  };
}
export type Viewer = ReturnType<typeof createViewer>;

interface PrefixMatch {
  id: string;
  prefix: string;
  team: { slug: string; org: { slug: string } };
}

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
  return { kind: 'issue', org, team, projectSlug: target, number: canonicalNumber(identifier) };
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
  const prefix = match[1];
  const number = canonicalNumber(match[2]);
  if (segments.length === 1) return { kind: 'issue', prefix, number };
  return { kind: 'issue', org: segments[0], team: segments[1], prefix, number };
}

/**
 * Digits without leading zeros, so AXM-042 and AXM-42 are one key.
 * @param digits - The digits as given
 */
function canonicalNumber(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '');
}

/**
 * What identifies the item a key names, however it was spelled: a URL's query and host, or leading
 * zeros, don't make it another key. A key that can't be parsed is only itself.
 * @param key - The key as given
 */
export function keyIdentity(key: string): string {
  try {
    return JSON.stringify(parseKey(key));
  } catch {
    return `invalid:${key}`;
  }
}

/**
 * The visible projects using a prefix.
 * @param prefix - The prefix
 * @param viewer - Who asks
 */
function visibleByPrefix(prefix: string, viewer: Viewer): Promise<PrefixMatch[]> {
  let found = viewer.byPrefix.get(prefix);
  if (!found) {
    found = viewer.projects().then((visible) =>
      prisma.project.findMany({
        where: { prefix, AND: [visible] },
        select: { id: true, ...PROJECT_URL_SELECT },
        orderBy: { id: 'asc' },
        take: MAX_CANDIDATES,
      }),
    );
    viewer.byPrefix.set(prefix, found);
  }
  return found;
}

/**
 * The project an issue key points into, among what the user can open.
 * @param parsed - The parsed key
 * @param issueNumber - The issue's number, for the candidates
 * @param viewer - Who asks
 * @throws {AppError} 404 for no such project, 409 AMBIGUOUS_KEY for a bare prefix that several
 * visible teams use
 */
async function resolveProjectId(
  parsed: ParsedIssueKey,
  issueNumber: number,
  viewer: Viewer,
): Promise<string> {
  if (parsed.org === undefined) {
    const projects = await visibleByPrefix(parsed.prefix, viewer);
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
      AND: [await viewer.projects()],
    },
    select: { id: true },
  });
  if (!project) throw keyNotFound();
  return project.id;
}

/**
 * Find an issue by key, for someone who may open it.
 * @param parsed - The parsed key
 * @param viewer - Who asks
 */
async function resolveIssueKey(parsed: ParsedIssueKey, viewer: Viewer): Promise<ResolvedKey> {
  const issueNumber = Number(parsed.number);
  if (issueNumber > MAX_ISSUE_NUMBER) throw keyNotFound();
  const projectId = await resolveProjectId(parsed, issueNumber, viewer);
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
    select: { id: true },
  });
  if (!issue) throw keyNotFound();
  return { kind: 'issue', projectId, issueNumber };
}

/**
 * Find a page by key, for someone who may view it: viewablePagesWhere, the rule of assertPageAccess
 * as a filter.
 * @param parsed - The parsed key
 * @param viewer - Who asks
 */
async function resolvePageKey(parsed: ParsedPageKey, viewer: Viewer): Promise<ResolvedKey> {
  const page = await prisma.page.findFirst({
    where: {
      slug: parsed.slug,
      space: { slug: parsed.space, team: { slug: parsed.team, org: { slug: parsed.org } } },
      AND: [await viewer.pages()],
    },
    select: { spaceId: true, slug: true },
  });
  if (!page) throw keyNotFound();
  return { kind: 'page', spaceId: page.spaceId, pageSlug: page.slug };
}

/**
 * Turn a key into the ids the services take. What it returns, the user may open.
 * @param key - AXM-42, org/team/AXM-42, org/team/space/page-slug or a URL of an issue or page
 * @param userId - Who asks
 * @param viewer - Their filters, when a call resolves several keys
 * @throws {AppError} 400 INVALID_KEY for no accepted form, 404 for nothing the user can see (never
 * 403), 409 AMBIGUOUS_KEY with details.candidates for a bare prefix several visible teams use
 */
export async function resolveKey(
  key: string,
  userId: string,
  viewer: Viewer = createViewer(userId),
): Promise<ResolvedKey> {
  const parsed = parseKey(key);
  return parsed.kind === 'page' ? resolvePageKey(parsed, viewer) : resolveIssueKey(parsed, viewer);
}

/** A container a key can name: the space or the project an action works in. */
export type ContainerKind = 'space' | 'project';

export type ResolvedContainer =
  | { kind: 'space'; spaceId: string }
  | { kind: 'project'; projectId: string };

const PROJECT_PREFIX = /^[A-Z][A-Z0-9]*$/;

/**
 * The text of a container key: org/team/space for a space, AXM or org/team/AXM for a project. Which
 * of the two a three-part key is depends on the action, so the caller says. Nothing is looked up.
 * @param key - The key as given
 * @param kind - What the action takes
 * @throws {AppError} 400 KEY_NOT_ACCEPTED for the key of an issue or page, INVALID_KEY otherwise
 */
function parseContainerKey(
  key: string,
  kind: ContainerKind,
): { org?: string; team?: string; name: string } {
  let item: ParsedKey | undefined;
  try {
    item = parseKey(key);
  } catch {
    item = undefined;
  }
  if (item) {
    const wanted =
      kind === 'space' ? 'a space as org/team/space' : 'a project as AXM or org/team/AXM';
    throw new AppError(400, `This action takes the key of ${wanted}`, 'KEY_NOT_ACCEPTED');
  }
  const segments = key.split('/');
  if (key.length > MAX_KEY_LENGTH || CONTROL_CHARACTER.test(key)) throw invalidKey();
  if (segments.some((segment) => segment === '')) throw invalidKey();
  if (kind === 'space') {
    if (segments.length !== 3) throw invalidKey();
    return { org: segments[0], team: segments[1], name: segments[2] };
  }
  if (segments.length !== 1 && segments.length !== 3) throw invalidKey();
  const name = segments[segments.length - 1];
  if (!PROJECT_PREFIX.test(name)) throw invalidKey();
  return segments.length === 1 ? { name } : { org: segments[0], team: segments[1], name };
}

/**
 * Turn the key of a space or a project into its id, for someone who may open it. What is invisible
 * and what is missing answer alike, and a bare prefix is ambiguous only among visible projects.
 * @param key - org/team/space, or AXM or org/team/AXM
 * @param kind - What the action takes
 * @param userId - Who asks
 * @throws {AppError} 400 INVALID_KEY or KEY_NOT_ACCEPTED, 404 for nothing the user can see, 409
 * AMBIGUOUS_KEY with details.candidates for a bare prefix several visible teams use
 */
export async function resolveContainerKey(
  key: string,
  kind: ContainerKind,
  userId: string,
): Promise<ResolvedContainer> {
  const parsed = parseContainerKey(key, kind);
  if (kind === 'project') {
    const viewer = createViewer(userId);
    if (parsed.org === undefined) {
      const projects = await visibleByPrefix(parsed.name, viewer);
      if (projects.length === 0) throw keyNotFound();
      if (projects.length > 1) {
        const candidates = projects.map(
          (project) => `${project.team.org.slug}/${project.team.slug}/${project.prefix}`,
        );
        throw new AppError(
          409,
          `This key matches projects in more than one team: ${candidates.join(', ')}`,
          'AMBIGUOUS_KEY',
          { candidates },
        );
      }
      return { kind, projectId: projects[0].id };
    }
    const project = await prisma.project.findFirst({
      where: {
        prefix: parsed.name,
        team: { slug: parsed.team, org: { slug: parsed.org } },
        AND: [await viewer.projects()],
      },
      select: { id: true },
    });
    if (!project) throw keyNotFound();
    return { kind, projectId: project.id };
  }
  const space = await prisma.wikiSpace.findFirst({
    where: {
      slug: parsed.name,
      team: { slug: parsed.team, org: { slug: parsed.org } },
    },
    select: { id: true },
  });
  if (
    !space ||
    (await checkWikiSpaceOrgAccess(space.id, userId)) !== 'ok' ||
    !(await canAccessSpace(space.id, userId, 'VIEW'))
  ) {
    throw keyNotFound();
  }
  return { kind, spaceId: space.id };
}
