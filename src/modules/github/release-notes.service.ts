// Release notes: on request, for a tag, the pull requests merged since the previous tag and the
// tickets linked to them, written to a wiki page and to the body of the GitHub Release, as the
// person who asked. Everything that can refuse does so before the first write, and every check
// that Axiom can make itself runs before the first GitHub call.
import { createHash } from 'node:crypto';

import type { GithubRepoLink } from '@prisma/client';
import { z } from 'zod';

import { spaceAccess } from '../../actions/authorize';
import type { ActionContext } from '../../actions/define';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { formatIssueKey } from '../../utils/issue-key';
import { logger } from '../../utils/logger';
import { writePageBody } from '../wiki/page-writes';
import { canEditPage } from '../wiki/wiki-permissions.service';
import { createPage } from '../wiki/wiki.service';

import { refPath, userAuth } from './github-actions.helpers';
import { instanceOrigin } from './github-app.service';
import { githubPaginate, githubRequest, type GithubAuth } from './github-client';
import { findRepoLinkByProject } from './repo-link.service';

/** How the first line of a body Axiom wrote starts: the marker, which carries a hash of the rest */
export const RELEASE_MARKER_PREFIX = '<!-- axiom:release-notes';
const MARKER_LINE = /^<!-- axiom:release-notes sha256=([0-9a-f]{64}) -->\r?\n/;
const INCOMPLETE =
  'These notes may be incomplete: GitHub listed only part of the commits or pull requests between the two tags.';

const COMPARE_PAGES = 10;
const MAX_COMMIT_LOOKUPS = 100;
const TITLE_MAX = 200;
const NAME_MAX = 100;
const SLUG_MAX = 50;

export interface ReleaseNotesInput {
  projectId: string;
  spaceId?: string;
  tag: string;
  previousTag?: string;
  replaceBody?: boolean;
}

export type ReleaseNotesResult = {
  pageUrl: string;
  releaseUrl: string;
  pullRequests: number;
  tickets: number;
  /** Whether GitHub listed only part of the commits or pull requests */
  truncated: boolean;
};

const releaseReply = z.looseObject({
  id: z.number(),
  tag_name: z.string(),
  body: z.string().nullable().optional(),
  html_url: z.string().optional(),
  draft: z.boolean().optional(),
  created_at: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
});
type Release = z.infer<typeof releaseReply>;

const commitReply = z.looseObject({ sha: z.string() });
const pullReply = z.looseObject({
  number: z.number(),
  title: z.string(),
  merged_at: z.string().nullable().optional(),
  user: z.looseObject({ login: z.string() }).nullable().optional(),
  base: z.looseObject({ ref: z.string() }).optional(),
});

/** A pull request of the notes, with the ids of its stored row when Axiom has one */
interface NotePull {
  number: number;
  title: string;
  login: string;
  storedId?: string;
}

interface NoteTicket {
  number: number;
  key: string;
  title: string;
  status: string;
}

const isNotFound = (err: unknown) =>
  err instanceof AppError && (err.code === 'GITHUB_NOT_FOUND' || err.code === 'GITHUB_GONE');

const tagPath = (tag: string) => encodeURIComponent(tag);

/**
 * A text as a Markdown code span on one line, so GitHub renders it as itself: no mention, no
 * issue or commit link, no formatting. The fence is one backtick longer than any run of backticks
 * in the text, and padded with a space when the text starts or ends with a backtick or a space,
 * which is how CommonMark lets a code span hold backticks.
 * @param text The text
 * @param max The longest text kept, in characters
 */
export function codeSpan(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim().slice(0, max);
  if (!line) return '';
  const longest = Math.max(0, ...(line.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = /^[` ]|[` ]$/.test(line) ? ' ' : '';
  return `${fence}${pad}${line}${pad}${fence}`;
}

/**
 * The hash a marker carries: of the body below the marker line, line ends and trailing space
 * aside, which GitHub's editor may change without anyone editing the text.
 * @param rest The body below the marker line
 */
const bodyHash = (rest: string) =>
  createHash('sha256').update(rest.replace(/\r\n/g, '\n').trimEnd()).digest('hex');

/**
 * A body under the marker line that carries its hash.
 * @param rest The body below the marker line
 */
const withMarker = (rest: string) =>
  `${RELEASE_MARKER_PREFIX} sha256=${bodyHash(rest)} -->\n${rest}`;

/**
 * Whether Axiom wrote this Release body and nobody changed it since: it starts with the marker
 * and the hash in the marker is the hash of the rest. A person's edit below the marker leaves the
 * marker in place (it is invisible) but breaks the hash.
 * @param body A Release body
 */
export function writtenByAxiom(body: string): boolean {
  const marker = MARKER_LINE.exec(body);
  return marker !== null && marker[1] === bodyHash(body.slice(marker[0].length));
}

// A GitHub login: the mention GitHub makes of it is the credit the notes give
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
// A status of plain words reads as written; anything else is shown as code
const PLAIN_WORDS = /^[\p{L}\p{N} _-]+$/u;

const releaseLogin = (login: string) =>
  GITHUB_LOGIN.test(login) ? `@${login}` : codeSpan(login, NAME_MAX);
const releaseStatus = (status: string) =>
  PLAIN_WORDS.test(status) ? status : codeSpan(status, NAME_MAX);
// A tag of these characters reads as written; anything else (`@`, `#`) is shown as code
const PLAIN_TAG = /^[A-Za-z0-9._/-]+$/;
const tagHeading = (tag: string) => (PLAIN_TAG.test(tag) ? tag : codeSpan(tag, TITLE_MAX));

/**
 * The notes as Markdown, under the marker. Every text that is not Axiom's own goes in a code span,
 * on the page as in the Release: a PR title or ticket title then renders as itself and links,
 * mentions or cross-links nothing, on GitHub (R15) or in Axiom (R14), and a code span survives the
 * editor's normalisation where backslash escapes do not. The Release keeps `#<n>` and `@<login>`,
 * which credit the work on GitHub; the page shows the login as code, as Axiom has no such user.
 * @param tag The release tag
 * @param pulls The pull requests, with the keys of their tickets
 * @param tickets The tickets
 * @param target Where the text is rendered
 * @param truncated Whether GitHub listed only part of the changes: the notes end saying so
 */
export function releaseMarkdown(
  tag: string,
  pulls: Array<NotePull & { keys: string[] }>,
  tickets: NoteTicket[],
  target: 'wiki' | 'github',
  truncated: boolean,
): string {
  const wiki = target === 'wiki';
  const title = (text: string) => codeSpan(text, TITLE_MAX);
  const login = (name: string) => (wiki ? codeSpan(`@${name}`, NAME_MAX) : releaseLogin(name));

  const pullLines = [...pulls]
    .sort((a, b) => a.number - b.number)
    .map((pr) => {
      const keys = pr.keys.length ? ` (${pr.keys.join(', ')})` : '';
      return `- #${pr.number} ${title(pr.title)} by ${login(pr.login)}${keys}`;
    });
  const ticketLines = [...tickets]
    .sort((a, b) => a.number - b.number)
    .map((t) => `- ${t.key} ${title(t.title)} (${releaseStatus(t.status)})`);

  return withMarker(
    [
      '',
      `## ${tagHeading(tag)}`,
      '',
      '### Pull requests',
      '',
      ...(pullLines.length ? pullLines : ['None']),
      '',
      '### Tickets',
      '',
      ...(ticketLines.length ? ticketLines : ['None']),
      '',
      ...(truncated ? [INCOMPLETE, ''] : []),
    ].join('\n'),
  );
}

/**
 * The space the notes go to: the one asked for (authorized by the action), else the project's
 * setting, checked here for edit as the action would have.
 * @param ctx Who asks
 * @param link The project's repository link
 * @param spaceId The space the request names
 * @throws {AppError} 400 RELEASE_NOTES_SPACE_REQUIRED, 403 or 404 from the space check
 */
async function notesSpace(
  ctx: ActionContext,
  link: GithubRepoLink,
  spaceId: string | undefined,
): Promise<string> {
  const chosen = spaceId ?? link.releaseNotesSpaceId;
  if (!chosen) {
    throw new AppError(
      400,
      "Choose a space for release notes in the project's GitHub settings, or pass spaceId",
      'RELEASE_NOTES_SPACE_REQUIRED',
    );
  }
  if (!spaceId) {
    await spaceAccess<{ spaceId: string }>('EDIT', (i) => i.spaceId)(ctx, { spaceId: chosen });
  }
  await assertTeamSpace(link.projectId, chosen);
  return chosen;
}

/**
 * Release notes go to a wiki space of the project's own team, whoever chose it.
 * @param projectId The project
 * @param spaceId The space
 * @throws {AppError} 400 RELEASE_NOTES_SPACE_INVALID
 */
async function assertTeamSpace(projectId: string, spaceId: string): Promise<void> {
  const [space, project] = await Promise.all([
    prisma.wikiSpace.findUnique({ where: { id: spaceId }, select: { teamId: true } }),
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { teamId: true } }),
  ]);
  if (!space || space.teamId !== project.teamId) {
    throw new AppError(
      400,
      "Release notes go to a wiki space of the project's own team",
      'RELEASE_NOTES_SPACE_INVALID',
    );
  }
}

/**
 * The page of the notes: the space's page titled `Release <tag>`, which the caller must be able
 * to edit, or the slug a new one gets.
 * @param ctx Who asks
 * @param spaceId The space
 * @param title The page title
 * @param tag The release tag
 * @param replaceBody Whether a page Axiom did not write may be replaced
 * @throws {AppError} 403 when the page exists and the caller may not edit it, 409
 *   RELEASE_PAGE_EXISTS when it does not start with the marker and replaceBody is not set
 */
async function notesPage(
  ctx: ActionContext,
  spaceId: string,
  title: string,
  tag: string,
  replaceBody: boolean,
): Promise<{ id: string; slug: string } | { id: null; slug: string }> {
  const existing = await prisma.page.findFirst({
    where: { spaceId, title },
    orderBy: { createdAt: 'asc' },
    select: { id: true, slug: true, body: true },
  });
  if (existing) {
    if (!(await canEditPage(ctx.userId, existing.id))) {
      throw new AppError(403, 'You do not have permission to edit the release notes page');
    }
    // The page is versioned, so only its marker is asked for: an edit below it is in the history
    if (!existing.body.startsWith(RELEASE_MARKER_PREFIX) && !replaceBody) {
      throw new AppError(
        409,
        `The page "${title}" exists and Axiom did not write it. Pass replaceBody to replace it.`,
        'RELEASE_PAGE_EXISTS',
      );
    }
    return { id: existing.id, slug: existing.slug };
  }
  const base =
    `release-${tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      .replace(/-+$/, '')
      .slice(0, SLUG_MAX - 4)
      .replace(/-+$/, '') || 'release';
  const taken = new Set(
    (
      await prisma.page.findMany({
        where: { spaceId, slug: { startsWith: base } },
        select: { slug: true },
      })
    ).map((p) => p.slug),
  );
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return { id: null, slug };
}

/**
 * The previous tag: the newest published Release other than this tag that was created before
 * this tag's Release (before now when the tag has none). One page of the list.
 * @param auth The caller's credential
 * @param repo The repository's API path
 * @param tag The release tag
 * @param release This tag's Release, when it has one
 * @throws {AppError} 400 RELEASE_PREVIOUS_TAG_REQUIRED
 */
async function previousRelease(
  auth: GithubAuth,
  repo: string,
  tag: string,
  release: Release | null,
): Promise<string> {
  const { items } = await githubPaginate<unknown>(auth, `${repo}/releases`, { maxPages: 1 });
  const before = release?.created_at ? Date.parse(release.created_at) : Date.now();
  const found = items
    .map((item) => releaseReply.safeParse(item))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .filter(
      (r) =>
        !r.draft &&
        r.published_at &&
        r.tag_name !== tag &&
        r.created_at &&
        Date.parse(r.created_at) < before,
    )
    .sort((a, b) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? ''));
  if (!found.length) {
    throw new AppError(
      400,
      'No earlier published release was found: pass previousTag',
      'RELEASE_PREVIOUS_TAG_REQUIRED',
    );
  }
  return found[0].tag_name;
}

/**
 * The pull requests in the commits between two tags: the stored merged ones whose merge commit
 * is among them, then GitHub's answer for each commit none of those matched (at most 100 calls),
 * keeping pull requests merged into the default branch.
 * @param auth The caller's credential
 * @param repo The repository's API path
 * @param link The repository link
 * @param shas The commits
 */
async function pullsOfCommits(
  auth: GithubAuth,
  repo: string,
  link: GithubRepoLink,
  shas: string[],
): Promise<{ pulls: NotePull[]; truncated: boolean }> {
  const stored = shas.length
    ? await prisma.githubPullRequest.findMany({
        where: { repoLinkId: link.id, state: 'MERGED', mergeCommitSha: { in: shas } },
        select: {
          id: true,
          number: true,
          title: true,
          authorLogin: true,
          mergeCommitSha: true,
          baseRef: true,
        },
      })
    : [];
  // Merged into the default branch, as the lookup below keeps them; a commit of another one is
  // still matched, as GitHub's answer for it would be refused the same way
  const pulls = new Map<number, NotePull>(
    stored
      .filter((pr) => pr.baseRef === link.defaultBranch)
      .map((pr) => [
        pr.number,
        { number: pr.number, title: pr.title, login: pr.authorLogin, storedId: pr.id },
      ]),
  );
  const matched = new Set(stored.map((pr) => pr.mergeCommitSha));
  const unmatched = shas.filter((sha) => !matched.has(sha));

  const found = new Map<number, NotePull>();
  let calls = 0;
  let truncated = false;
  for (const sha of unmatched) {
    if (calls >= MAX_COMMIT_LOOKUPS) {
      truncated = true;
      logger.info(
        'release notes looked up the pull requests of the first 100 unmatched commits only',
        {
          repoLinkId: link.id,
          skipped: unmatched.length - calls,
        },
      );
      break;
    }
    calls++;
    const reply = await githubRequest<unknown>(
      auth,
      'GET',
      `${repo}/commits/${encodeURIComponent(sha)}/pulls`,
    ).catch((err: unknown) => {
      if (isNotFound(err) || (err instanceof AppError && err.code === 'GITHUB_INVALID')) {
        return null;
      }
      throw err;
    });
    const list = Array.isArray(reply?.data) ? reply.data : [];
    for (const item of list) {
      const parsed = pullReply.safeParse(item);
      if (!parsed.success) continue;
      const pr = parsed.data;
      if (!pr.merged_at || pr.base?.ref !== link.defaultBranch) continue;
      if (pulls.has(pr.number) || found.has(pr.number)) continue;
      found.set(pr.number, {
        number: pr.number,
        title: pr.title,
        login: pr.user?.login ?? 'ghost',
      });
    }
  }
  // A pull request Axiom stored keeps its links, whatever its stored merge commit says
  if (found.size) {
    const rows = await prisma.githubPullRequest.findMany({
      where: { repoLinkId: link.id, number: { in: [...found.keys()] } },
      select: { id: true, number: true },
    });
    for (const row of rows) {
      const pr = found.get(row.number);
      if (pr) pr.storedId = row.id;
    }
  }
  return { pulls: [...pulls.values(), ...found.values()], truncated };
}

/**
 * The tickets linked to the pull requests through any source, and the keys of each pull request.
 * @param link The repository link
 * @param pulls The pull requests
 */
async function ticketsOf(
  link: GithubRepoLink,
  pulls: NotePull[],
): Promise<{ tickets: NoteTicket[]; keysByPull: Map<string, string[]> }> {
  const ids = pulls.flatMap((pr) => (pr.storedId ? [pr.storedId] : []));
  const links = ids.length
    ? await prisma.githubIssueLink.findMany({
        where: { repoLinkId: link.id, targetType: 'PULL_REQUEST', targetKey: { in: ids } },
        select: { issueId: true, targetKey: true },
      })
    : [];
  const issues = links.length
    ? await prisma.issue.findMany({
        where: { id: { in: [...new Set(links.map((l) => l.issueId))] }, projectId: link.projectId },
        select: {
          id: true,
          number: true,
          title: true,
          column: { select: { name: true } },
          project: { select: { prefix: true } },
        },
      })
    : [];
  const byId = new Map(
    issues.map((issue) => [
      issue.id,
      {
        number: issue.number,
        key: formatIssueKey(issue.project.prefix, issue.number),
        title: issue.title,
        status: issue.column?.name ?? 'Backlog',
      },
    ]),
  );
  const ticketsByPull = new Map<string, Map<number, NoteTicket>>();
  for (const l of links) {
    const ticket = byId.get(l.issueId);
    if (!ticket) continue;
    const tickets = ticketsByPull.get(l.targetKey) ?? new Map<number, NoteTicket>();
    tickets.set(ticket.number, ticket);
    ticketsByPull.set(l.targetKey, tickets);
  }
  const keysByPull = new Map(
    [...ticketsByPull].map(([pullId, tickets]) => [
      pullId,
      [...tickets.values()].sort((a, b) => a.number - b.number).map((t) => t.key),
    ]),
  );
  return { tickets: [...byId.values()], keysByPull };
}

/**
 * Writes the release notes of a tag to a wiki page and to the GitHub Release, as the caller.
 * The order is the refusal order. First what Axiom decides alone: the space (of the project's
 * team, editable), the page (editable, Axiom's unless replaceBody) and the GitHub connection.
 * Then GitHub, read only: push rights on the repository, the tag, a Release body a person wrote
 * or edited, the previous tag and the commits between. Only then the page and the Release are
 * written. Tickets get no activity and no automation runs (R16).
 * @param ctx Who asks; the action has checked issue edit on the project and edit on a named space
 * @param input What to write
 * @throws {AppError} 409 GITHUB_NOT_LINKED, 400 RELEASE_NOTES_SPACE_REQUIRED or
 *   RELEASE_NOTES_SPACE_INVALID, 409 RELEASE_PAGE_EXISTS, 409 GITHUB_NOT_CONNECTED, 403
 *   GITHUB_FORBIDDEN, 404 GITHUB_TAG_NOT_FOUND, 409 GITHUB_RELEASE_BODY_EXISTS, 400
 *   RELEASE_PREVIOUS_TAG_REQUIRED, 400 RELEASE_NO_CHANGES
 */
export async function writeReleaseNotes(
  ctx: ActionContext,
  input: ReleaseNotesInput,
): Promise<ReleaseNotesResult> {
  const { projectId, tag } = input;
  const replaceBody = input.replaceBody === true;
  const link = await findRepoLinkByProject(projectId);
  if (!link) {
    throw new AppError(409, 'This project has no linked GitHub repository', 'GITHUB_NOT_LINKED');
  }
  const spaceId = await notesSpace(ctx, link, input.spaceId);
  const title = `Release ${tag}`;
  const page = await notesPage(ctx, spaceId, title, tag, replaceBody);
  const { auth } = await userAuth(ctx);
  const repo = `/repositories/${link.repoId}`;

  await assertCanPush(auth, repo, link);
  const tagMissing = () =>
    new AppError(
      404,
      `GitHub has no tag ${tag} in ${link.fullName}, or your connection cannot see it`,
      'GITHUB_TAG_NOT_FOUND',
    );
  // The compare resolves any ref, and creating a Release for a name that is no tag makes one
  await githubRequest<unknown>(auth, 'GET', `${repo}/git/ref/tags/${refPath(tag)}`).catch(
    (err: unknown) => {
      throw isNotFound(err) ? tagMissing() : err;
    },
  );

  const release = await githubRequest<unknown>(
    auth,
    'GET',
    `${repo}/releases/tags/${tagPath(tag)}`,
  ).then(
    (reply) => releaseReply.parse(reply.data),
    (err: unknown) => {
      if (isNotFound(err)) return null;
      throw err;
    },
  );
  const body = release?.body ?? '';
  if (body.trim() && !writtenByAxiom(body) && !replaceBody) {
    throw new AppError(
      409,
      `The GitHub release ${tag} has a body that Axiom did not write, or that was edited since. Pass replaceBody to replace it.`,
      'GITHUB_RELEASE_BODY_EXISTS',
    );
  }

  const previous = input.previousTag ?? (await previousRelease(auth, repo, tag, release));
  const compared = await githubPaginate<unknown>(
    auth,
    `${repo}/compare/${tagPath(previous)}...${tagPath(tag)}`,
    { maxPages: COMPARE_PAGES, itemsKey: 'commits' },
  ).catch((err: unknown) => {
    if (isNotFound(err)) {
      throw new AppError(
        404,
        `GitHub has no tag ${tag} or ${previous} in ${link.fullName}, or your connection cannot see it`,
        'GITHUB_TAG_NOT_FOUND',
      );
    }
    throw err;
  });
  const shas = [
    ...new Set(
      compared.items.flatMap((item) => {
        const parsed = commitReply.safeParse(item);
        return parsed.success ? [parsed.data.sha] : [];
      }),
    ),
  ];
  if (!shas.length) {
    throw new AppError(
      400,
      `There are no commits from ${previous} to ${tag}. Pass the tag of an earlier release as previousTag.`,
      'RELEASE_NO_CHANGES',
    );
  }

  const found = await pullsOfCommits(auth, repo, link, shas);
  const truncated = !compared.complete || found.truncated;
  const { tickets, keysByPull } = await ticketsOf(link, found.pulls);
  const withKeys = found.pulls.map((pr) => ({
    ...pr,
    keys: (pr.storedId && keysByPull.get(pr.storedId)) || [],
  }));

  const wikiBody = releaseMarkdown(tag, withKeys, tickets, 'wiki', truncated);
  const written = page.id
    ? (
        await writePageBody({
          pageId: page.id,
          authorId: ctx.userId,
          body: wikiBody,
          changeDescription: `Release notes for ${tag}`,
          kind: 'EDIT',
          source: ctx.channel === 'mcp' ? 'mcp' : 'api',
        })
      ).page
    : await createPage(spaceId, ctx.userId, { title, slug: page.slug, body: wikiBody });

  const releaseBody = releaseMarkdown(tag, withKeys, tickets, 'github', truncated);
  const saved = release
    ? await githubRequest<unknown>(auth, 'PATCH', `${repo}/releases/${release.id}`, {
        body: { body: releaseBody },
      })
    : await githubRequest<unknown>(auth, 'POST', `${repo}/releases`, {
        body: { tag_name: tag, name: tag, body: releaseBody, draft: false },
      });
  const savedUrl = releaseReply.safeParse(saved.data).data?.html_url;

  const space = await prisma.wikiSpace.findUniqueOrThrow({
    where: { id: spaceId },
    select: { slug: true, team: { select: { slug: true, org: { select: { slug: true } } } } },
  });
  return {
    pageUrl: `${instanceOrigin()}/${space.team.org.slug}/${space.team.slug}/wiki/${space.slug}/${written.slug}`,
    releaseUrl:
      savedUrl && /^https:\/\/[^\s<>"]+$/.test(savedUrl)
        ? savedUrl
        : `${link.htmlUrl}/releases/tag/${tagPath(tag)}`,
    pullRequests: withKeys.length,
    tickets: tickets.length,
    truncated,
  };
}

const repoPermissions = z.looseObject({
  permissions: z.looseObject({ push: z.boolean().optional() }).optional(),
});

/**
 * Whether the caller may write the repository's Releases, asked of GitHub before Axiom writes
 * anything, so a reader without push rights gets no page version and no half-written notes.
 * @param auth The caller's credential
 * @param repo The repository's API path
 * @param link The repository link
 * @throws {AppError} 403 GITHUB_FORBIDDEN
 */
async function assertCanPush(auth: GithubAuth, repo: string, link: GithubRepoLink): Promise<void> {
  const { data } = await githubRequest<unknown>(auth, 'GET', repo);
  if (repoPermissions.safeParse(data).data?.permissions?.push !== true) {
    throw new AppError(
      403,
      `Your GitHub account may not write releases of ${link.fullName}: it needs push access.`,
      'GITHUB_FORBIDDEN',
    );
  }
}

/**
 * Sets the space release notes go to when a request names none, or clears it.
 * @param projectId The project
 * @param spaceId A space of the project's team, or null
 * @throws {AppError} 409 GITHUB_NOT_LINKED, 400 RELEASE_NOTES_SPACE_INVALID
 */
export async function setReleaseNotesSpace(
  projectId: string,
  spaceId: string | null,
): Promise<{ repoFullName: string; releaseNotesSpaceId: string | null }> {
  const link = await findRepoLinkByProject(projectId);
  if (!link) {
    throw new AppError(409, 'This project has no linked GitHub repository', 'GITHUB_NOT_LINKED');
  }
  if (spaceId !== null) await assertTeamSpace(projectId, spaceId);
  const updated = await prisma.githubRepoLink.update({
    where: { id: link.id },
    data: { releaseNotesSpaceId: spaceId },
    select: { fullName: true, releaseNotesSpaceId: true },
  });
  return { repoFullName: updated.fullName, releaseNotesSpaceId: updated.releaseNotesSpaceId };
}
