/**
 * What an approver reads, one function per action that can wait for approval. Built by the server
 * from database values and shown as plain text. A missing item answers 404 here, so no request is
 * made that could only fail.
 *
 * Text an agent can change without approval (a title, a name, a comment) is data: it is quoted and
 * bounded, and never the only thing that identifies an item. Keys, slugs, owners and dates do that.
 * A fact that can change while the request waits says it dates from the request.
 */
import { prisma } from '../config/database';
import { loggableExternalUrl } from '../lib/request-path';
import { assertIssueRefsInProject } from '../modules/issues/issue-references';
import { ERR } from '../utils/error-messages';
import { findOrThrow } from '../utils/find-or-throw';

const MAX_QUOTED_LENGTH = 80;
/** How many keys a bulk preview spells out. */
const MAX_LISTED_KEYS = 10;

/**
 * Text an agent may have written, on one line, with quotes of its own that can't end the quote.
 * @param text - The text
 */
function quoted(text: string): string {
  const line = text.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  return line.length > MAX_QUOTED_LENGTH ? `"${line.slice(0, MAX_QUOTED_LENGTH)}..."` : `"${line}"`;
}

/**
 * The end of an id: names and owners can match, and this tells two such items apart.
 * @param id - The id
 */
function shortId(id: string): string {
  return `#${id.slice(-8)}`;
}

/**
 * A date as it reads in a preview.
 * @param date - The date
 */
function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * An amount of a thing with its singular or plural.
 * @param count - How many
 * @param one - The singular
 * @param many - The plural
 */
function amount(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * A file size as it reads in a preview.
 * @param bytes - The size
 */
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

const ISSUE_KEY = { number: true, project: { select: { prefix: true } } } as const;

/**
 * An issue's key.
 * @param issue - The issue
 * @param issue.number - Its number
 * @param issue.project - Its project
 * @param issue.project.prefix - The project's prefix
 */
function keyOf(issue: { number: number; project: { prefix: string } }): string {
  return `${issue.project.prefix}-${issue.number}`;
}

/**
 * Some keys and how many more.
 * @param keys - The keys
 */
function keyList(keys: string[]): string {
  const listed = keys.slice(0, MAX_LISTED_KEYS).join(', ');
  const rest = keys.length - MAX_LISTED_KEYS;
  return rest > 0 ? `${listed} and ${rest} more` : listed;
}

/**
 * The note for ids that fall outside the project: the handlers ignore those.
 * @param given - How many ids were given
 * @param found - How many are in the project
 */
function ignoredNote(given: number, found: number): string {
  const ignored = given - found;
  if (ignored === 0) return '';
  return `. ${amount(ignored, 'id')} outside this project ${ignored === 1 ? 'is' : 'are'} ignored`;
}

/**
 * @param projectId - The project in the input
 * @param issueNumber - The issue's number
 */
export async function issueDelete(projectId: string, issueNumber: number): Promise<string> {
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: issueNumber } },
      select: { ...ISSUE_KEY, title: true, _count: { select: { children: true } } },
    }),
    ERR.ISSUE_NOT_FOUND,
  );
  const subtasks = issue._count.children;
  const left =
    subtasks === 0
      ? ''
      : `. Its ${amount(subtasks, 'subtask')}, as of this request, ` +
        `${subtasks === 1 ? 'stays' : 'stay'} without a parent`;
  return `Delete ${keyOf(issue)} ${quoted(issue.title)}${left}`;
}

/**
 * @param spaceId - The space in the input
 * @param pageSlug - The page's slug
 */
export async function pageDelete(spaceId: string, pageSlug: string): Promise<string> {
  const page = await findOrThrow(
    prisma.page.findUnique({
      where: { spaceId_slug: { spaceId, slug: pageSlug } },
      select: {
        title: true,
        slug: true,
        space: { select: { name: true, slug: true } },
        _count: { select: { children: true } },
      },
    }),
    ERR.PAGE_NOT_FOUND,
  );
  const children = page._count.children;
  const left =
    children === 0
      ? ''
      : `. Its ${amount(children, 'child page')}, as of this request, ` +
        `${children === 1 ? 'stays' : 'stay'} without a parent`;
  return (
    `Delete the page ${page.slug} ${quoted(page.title)} in space ${page.space.slug} ` +
    `${quoted(page.space.name)}${left}`
  );
}

/**
 * @param commentId - The comment
 */
export async function commentDelete(commentId: string): Promise<string> {
  const comment = await findOrThrow(
    prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        body: true,
        createdAt: true,
        author: { select: { username: true } },
        issue: { select: ISSUE_KEY },
      },
    }),
    'Comment not found',
  );
  return (
    `Delete the comment by ${comment.author.username} on ${keyOf(comment.issue)} of ` +
    `${day(comment.createdAt)}: ${quoted(comment.body)}`
  );
}

/**
 * @param linkId - The link between two issues
 */
export async function issueLinkDelete(linkId: string): Promise<string> {
  const link = await findOrThrow(
    prisma.issueLink.findUnique({
      where: { id: linkId },
      select: { type: true, from: { select: ISSUE_KEY }, to: { select: ISSUE_KEY } },
    }),
    'Link not found',
  );
  return `Remove the link ${keyOf(link.from)} ${link.type} ${keyOf(link.to)}`;
}

/**
 * @param linkId - The external link
 */
export async function issueWebLinkDelete(linkId: string): Promise<string> {
  const link = await findOrThrow(
    prisma.issueWebLink.findUnique({
      where: { id: linkId },
      select: { url: true, title: true, issue: { select: ISSUE_KEY } },
    }),
    'Link not found',
  );
  // Without its query: a preview goes into a notification and an email
  const title = link.title ? ` ${quoted(link.title)}` : '';
  return `Remove the link to ${loggableExternalUrl(link.url)}${title} from ${keyOf(link.issue)}`;
}

/**
 * @param id - The attachment
 */
export async function attachmentDelete(id: string): Promise<string> {
  const file = await findOrThrow(
    prisma.attachment.findUnique({
      where: { id },
      select: {
        originalName: true,
        mimeType: true,
        size: true,
        uploader: { select: { username: true } },
        issue: { select: ISSUE_KEY },
        page: { select: { slug: true, space: { select: { slug: true } } } },
        comment: { select: { issue: { select: ISSUE_KEY } } },
      },
    }),
    'Attachment not found',
  );
  const issue = file.issue ?? file.comment?.issue;
  let parent = 'not attached to anything yet';
  if (issue) parent = `on ${keyOf(issue)}`;
  else if (file.page) parent = `on the page ${file.page.slug} in space ${file.page.space.slug}`;
  return (
    `Delete the file ${quoted(file.originalName)} (${file.mimeType}, ${fileSize(file.size)}) ` +
    `uploaded by ${file.uploader.username} ${parent}`
  );
}

/**
 * @param id - The saved query
 */
export async function savedQueryDelete(id: string): Promise<string> {
  const saved = await findOrThrow(
    prisma.savedFilter.findUnique({
      where: { id },
      select: {
        name: true,
        visibility: true,
        createdAt: true,
        user: { select: { username: true } },
      },
    }),
    'Saved query not found',
  );
  return (
    `Delete the saved query ${quoted(saved.name)} ${shortId(id)} by ${saved.user.username}, ` +
    `shared ${saved.visibility}, made ${day(saved.createdAt)}`
  );
}

/**
 * @param id - The dashboard
 */
export async function dashboardDelete(id: string): Promise<string> {
  const dashboard = await findOrThrow(
    prisma.dashboard.findUnique({
      where: { id },
      select: {
        name: true,
        visibility: true,
        createdAt: true,
        owner: { select: { username: true } },
        _count: { select: { widgets: true } },
      },
    }),
    'Dashboard not found',
  );
  return (
    `Delete the dashboard ${quoted(dashboard.name)} ${shortId(id)} by ` +
    `${dashboard.owner.username}, ` +
    `shared ${dashboard.visibility}, made ${day(dashboard.createdAt)}, ` +
    `with its ${amount(dashboard._count.widgets, 'widget')} as of this request`
  );
}

/**
 * @param dashboardId - The dashboard in the input
 * @param widgetId - The widget
 */
export async function dashboardWidgetRemove(
  dashboardId: string,
  widgetId: string,
): Promise<string> {
  const widget = await findOrThrow(
    prisma.dashboardWidget.findFirst({
      where: { id: widgetId, dashboardId },
      select: {
        type: true,
        title: true,
        dashboard: { select: { name: true, owner: { select: { username: true } } } },
      },
    }),
    'Widget not found',
  );
  return (
    `Remove the ${widget.type} widget ${quoted(widget.title)} ${shortId(widgetId)} from the ` +
    `dashboard ${quoted(widget.dashboard.name)} ${shortId(dashboardId)} by ` +
    `${widget.dashboard.owner.username}`
  );
}

/**
 * The issue by key only: who may edit a page need not see the project of an issue linked to it.
 * @param pageId - The page
 * @param issueId - The issue
 */
export async function pageIssueLinkRemove(pageId: string, issueId: string): Promise<string> {
  const link = await findOrThrow(
    prisma.wikiPageIssueLink.findFirst({
      where: { pageId, issueId, linkType: 'EMBED' },
      select: {
        issue: { select: ISSUE_KEY },
        page: { select: { slug: true, space: { select: { slug: true } } } },
      },
    }),
    'Link not found',
  );
  return (
    `Remove the link between the page ${link.page.slug} in space ${link.page.space.slug} ` +
    `and ${keyOf(link.issue)}`
  );
}

/** What issue.bulkUpdate changes. */
interface BulkUpdates {
  status?: string;
  assigneeId?: string | null;
  priority?: string;
  sprintId?: string | null;
  labels?: string[];
}

/**
 * The changes of a bulk update by name, in a fixed order. A name is only looked up inside the
 * project and its team, so an id tells nothing about what lies outside them.
 * @param projectId - The project
 * @param updates - The changes
 */
async function bulkChanges(projectId: string, updates: BulkUpdates): Promise<string> {
  const changes: string[] = [];
  if (updates.assigneeId !== undefined) {
    const user = updates.assigneeId
      ? await prisma.user.findFirst({
          where: {
            id: updates.assigneeId,
            teamMemberships: { some: { team: { projects: { some: { id: projectId } } } } },
          },
          select: { username: true },
        })
      : null;
    changes.push(
      updates.assigneeId === null
        ? 'assignee to nobody'
        : `assignee to ${user?.username ?? 'someone outside this team'}`,
    );
  }
  if (updates.labels !== undefined) {
    changes.push(`labels to ${updates.labels.map(quotedLabel).join(', ') || 'none'}`);
  }
  if (updates.priority !== undefined) changes.push(`priority to ${updates.priority}`);
  if (updates.sprintId !== undefined) {
    const sprint = updates.sprintId
      ? await prisma.sprint.findFirst({
          where: { id: updates.sprintId, projectId },
          select: { name: true },
        })
      : null;
    changes.push(
      updates.sprintId === null
        ? 'sprint to none'
        : `sprint to ${sprint ? quoted(sprint.name) : 'one outside this project'}`,
    );
  }
  if (updates.status !== undefined) {
    const column = await prisma.boardColumn.findFirst({
      where: { id: updates.status, projectId },
      select: { name: true },
    });
    changes.push(`status to ${column ? quoted(column.name) : 'one outside this project'}`);
  }
  return changes.join(', ') || 'nothing';
}

/**
 * A label as a bulk preview names it: bare when it is one plain word.
 * @param label - The label
 */
function quotedLabel(label: string): string {
  return /^[\w-]{1,40}$/.test(label) ? label : quoted(label);
}

/**
 * @param projectId - The project in the input
 * @param issueIds - The issues
 * @param updates - The changes
 */
export async function issueBulkUpdate(
  projectId: string,
  issueIds: string[],
  updates: BulkUpdates,
): Promise<string> {
  const project = await findOrThrow(
    prisma.project.findUnique({ where: { id: projectId }, select: { prefix: true } }),
    ERR.PROJECT_NOT_FOUND,
  );
  const issues = await prisma.issue.findMany({
    where: { id: { in: issueIds }, projectId },
    select: ISSUE_KEY,
    orderBy: { number: 'asc' },
  });
  const unique = new Set(issueIds).size;
  return (
    `Change ${amount(issues.length, 'issue')} of ${project.prefix} ` +
    `(${keyList(issues.map(keyOf))}): ${await bulkChanges(projectId, updates)}` +
    ignoredNote(unique, issues.length)
  );
}

/**
 * @param sprintId - The sprint
 * @param issueIds - The issues
 */
export async function sprintAddIssues(sprintId: string, issueIds: string[]): Promise<string> {
  const sprint = await findOrThrow(
    prisma.sprint.findUnique({
      where: { id: sprintId },
      select: {
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        projectId: true,
        project: { select: { prefix: true } },
      },
    }),
    ERR.SPRINT_NOT_FOUND,
  );
  const issues = await prisma.issue.findMany({
    where: { id: { in: issueIds }, projectId: sprint.projectId },
    select: ISSUE_KEY,
    orderBy: { number: 'asc' },
  });
  const unique = new Set(issueIds).size;
  return (
    `Add ${amount(issues.length, 'issue')} of ${sprint.project.prefix} to the sprint ` +
    `${quoted(sprint.name)} (${sprint.status}, ${day(sprint.startDate)} to ${day(sprint.endDate)}): ` +
    `${keyList(issues.map(keyOf))}${ignoredNote(unique, issues.length)}`
  );
}

/**
 * @param projectId - The project in the input
 * @param issueNumber - The issue's number
 * @param columnId - The column to move it to
 */
export async function issueMove(
  projectId: string,
  issueNumber: number,
  columnId: string,
): Promise<string> {
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: issueNumber } },
      select: { ...ISSUE_KEY, title: true, column: { select: { name: true } } },
    }),
    ERR.ISSUE_NOT_FOUND,
  );
  // What moveIssue refuses is refused here, with its own answer: such a request could only fail
  await assertIssueRefsInProject(projectId, { columnId });
  const target = await findOrThrow(
    prisma.boardColumn.findUnique({ where: { id: columnId }, select: { name: true } }),
    'Column not found',
  );
  const name = `Move ${keyOf(issue)} ${quoted(issue.title)}`;
  const from = issue.column ? ` from column ${quoted(issue.column.name)}, as of this request,` : '';
  return `${name}${from} to column ${quoted(target.name)}`;
}

/**
 * Only for a destination the caller may write: the handler checks that again, and this names it.
 * @param pageId - The page
 * @param targetSpaceId - The space to move it to, if given
 * @param targetParentId - The page to move it under, if given
 */
export async function pageMove(
  pageId: string,
  targetSpaceId?: string,
  targetParentId?: string | null,
): Promise<string> {
  const page = await findOrThrow(
    prisma.page.findUnique({
      where: { id: pageId },
      select: { title: true, slug: true, spaceId: true, space: { select: { slug: true } } },
    }),
    ERR.PAGE_NOT_FOUND,
  );
  const parent = targetParentId
    ? await findOrThrow(
        prisma.page.findUnique({
          where: { id: targetParentId },
          select: { slug: true, spaceId: true },
        }),
        ERR.PAGE_NOT_FOUND,
      )
    : null;
  const spaceId = targetSpaceId ?? parent?.spaceId ?? page.spaceId;
  const space = await findOrThrow(
    prisma.wikiSpace.findUnique({ where: { id: spaceId }, select: { name: true, slug: true } }),
    'Space not found',
  );
  const to = spaceId === page.spaceId ? '' : ` to space ${space.slug} ${quoted(space.name)}`;
  const under = parent ? ` under the page ${parent.slug}` : '';
  return `Move the page ${page.slug} ${quoted(page.title)} from space ${page.space.slug}${to}${under}`;
}
