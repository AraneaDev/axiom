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

// Admin reach: what a person reads before an agent changes who may reach what. Each names the thing
// by what an agent can't rename on its own (a slug, a prefix, a username) next to what it can.

/**
 * An organization as a preview names it.
 * @param orgId - The org
 */
async function orgLabel(orgId: string): Promise<string> {
  const org = await findOrThrow(
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, slug: true } }),
    ERR.ORGANIZATION_NOT_FOUND,
  );
  return `organization ${org.slug} ${quoted(org.name)}`;
}

/**
 * A team as a preview names it.
 * @param teamId - The team
 */
async function teamLabel(teamId: string): Promise<string> {
  const team = await findOrThrow(
    prisma.team.findUnique({
      where: { id: teamId },
      select: { name: true, slug: true, org: { select: { slug: true } } },
    }),
    ERR.TEAM_NOT_FOUND,
  );
  return `team ${team.org.slug}/${team.slug} ${quoted(team.name)}`;
}

/**
 * A wiki space as a preview names it.
 * @param spaceId - The space
 */
async function spaceLabel(spaceId: string): Promise<string> {
  const space = await findOrThrow(
    prisma.wikiSpace.findUnique({ where: { id: spaceId }, select: { name: true, slug: true } }),
    ERR.SPACE_NOT_FOUND,
  );
  return `space ${space.slug} ${quoted(space.name)}`;
}

/**
 * A wiki page as a preview names it.
 * @param pageId - The page
 */
async function pageLabel(pageId: string): Promise<string> {
  const page = await findOrThrow(
    prisma.page.findUnique({
      where: { id: pageId },
      select: { title: true, slug: true, space: { select: { slug: true } } },
    }),
    ERR.PAGE_NOT_FOUND,
  );
  return `page ${page.space.slug}/${page.slug} ${quoted(page.title)}`;
}

/**
 * Whether a caller may read a user's name: themselves, someone they share an org with, or anyone
 * for a platform admin. The agent reads a preview before a person acts (A28).
 * @param viewerId - Who asks
 * @param userIds - The users, which need not exist
 * @returns The usernames of those the caller may read, by id
 */
async function visibleUsernames(
  viewerId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { isAdmin: true },
  });
  const users = await prisma.user.findMany({
    where: {
      id: { in: [...userIds] },
      ...(viewer?.isAdmin
        ? {}
        : {
            OR: [
              { id: viewerId },
              { orgMemberships: { some: { org: { members: { some: { userId: viewerId } } } } } },
            ],
          }),
    },
    select: { id: true, username: true },
  });
  return new Map(users.map((user) => [user.id, user.username]));
}

/**
 * A user as a preview names them: the end of the id, as usernames can look alike, and the username
 * only for a caller who may read it. Anyone else reads the id alone, for a user who is hidden and
 * for one who isn't there, so the answer tells them apart for no one.
 * @param viewerId - Who asks
 * @param userId - The user
 */
async function userLabel(viewerId: string, userId: string): Promise<string> {
  const username = (await visibleUsernames(viewerId, [userId])).get(userId);
  return username ? `user ${username} ${shortId(userId)}` : `user ${shortId(userId)}`;
}

/**
 * The account an admin action works on, for a caller already known to be a platform admin: one who
 * can see every user, so an absent one can answer 404 and no request is made.
 * @param userId - The user
 */
async function adminTargetLabel(userId: string): Promise<string> {
  const user = await findOrThrow(
    prisma.user.findUnique({ where: { id: userId }, select: { username: true } }),
    ERR.USER_NOT_FOUND,
  );
  return `user ${user.username} ${shortId(userId)}`;
}

/**
 * A team named in an org's own request. Another org's team answers as one that isn't there, for it
 * is a name the caller may have no way to read (A28).
 * @param orgId - The org the action works on
 * @param teamId - The team the input names
 */
async function teamOfOrgLabel(orgId: string, teamId: string): Promise<string> {
  const team = await findOrThrow(
    prisma.team.findFirst({ where: { id: teamId, orgId }, select: { id: true } }),
    ERR.TEAM_NOT_FOUND,
  );
  return teamLabel(team.id);
}

/**
 * The optional text of something new, as it reads at the end of a sentence.
 * @param description - The description, if given
 */
function withDescription(description?: string): string {
  return description ? `, described as ${quoted(description)}` : '';
}

/**
 * What an update would set, as it reads in a preview. Values come from the agent, so they are data.
 * @param fields - The fields of the input that are about to change
 */
function changeList(fields: Record<string, string | boolean | null | undefined>): string {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([field, value]) => `${field} to ${typeof value === 'string' ? quoted(value) : value}`);
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

/**
 * @param name - The new org's name
 * @param slug - Its slug
 * @param description - Its description, if any
 */
export function orgCreate(name: string, slug: string, description?: string): Promise<string> {
  return Promise.resolve(
    `Create the organization ${slug} ${quoted(name)}${withDescription(description)}, with you as its owner`,
  );
}

/**
 * @param orgId - The org
 * @param fields - What changes
 */
export async function orgUpdate(
  orgId: string,
  fields: Record<string, string | undefined>,
): Promise<string> {
  return `In ${await orgLabel(orgId)}, set ${changeList(fields)}`;
}

/** @param orgId - The org */
export async function orgDelete(orgId: string): Promise<string> {
  const label = await orgLabel(orgId);
  const [teams, members] = await Promise.all([
    prisma.team.count({ where: { orgId } }),
    prisma.orgMembership.count({ where: { orgId } }),
  ]);
  const projects = await prisma.project.count({ where: { team: { orgId } } });
  return (
    `Delete ${label} with everything in it. As of this request that is ` +
    `${amount(teams, 'team')}, ${amount(projects, 'project')} and ${amount(members, 'member')}`
  );
}

/**
 * The role a user holds in an org.
 * @param orgId - The org
 * @param userId - The user
 */
async function orgRoleOf(orgId: string, userId: string): Promise<string> {
  const membership = await findOrThrow(
    prisma.orgMembership.findFirst({ where: { orgId, userId }, select: { role: true } }),
    ERR.MEMBERSHIP_NOT_FOUND,
  );
  return membership.role;
}

/**
 * @param viewerId - Who asks
 * @param orgId - The org
 * @param userId - Who joins
 * @param role - With what role
 */
export async function orgMemberAdd(
  viewerId: string,
  orgId: string,
  userId: string,
  role: string,
): Promise<string> {
  return `Add ${await userLabel(viewerId, userId)} to ${await orgLabel(orgId)} as ${role}`;
}

/**
 * @param viewerId - Who asks
 * @param orgId - The org
 * @param memberId - The user
 * @param role - The new role
 */
export async function orgMemberUpdate(
  viewerId: string,
  orgId: string,
  memberId: string,
  role: string,
): Promise<string> {
  const current = await orgRoleOf(orgId, memberId);
  return `Change ${await userLabel(viewerId, memberId)} in ${await orgLabel(orgId)} from ${current} to ${role}`;
}

/**
 * @param viewerId - Who asks
 * @param orgId - The org
 * @param memberId - The user
 */
export async function orgMemberRemove(
  viewerId: string,
  orgId: string,
  memberId: string,
): Promise<string> {
  const current = await orgRoleOf(orgId, memberId);
  return (
    `Remove ${await userLabel(viewerId, memberId)}, now ${current}, from ${await orgLabel(orgId)}, ` +
    'with their team places, space permissions and page access there'
  );
}

/**
 * @param orgId - The org
 * @param teamId - Only this team's, if given
 */
export async function invitationList(orgId: string, teamId?: string): Promise<string> {
  const only = teamId ? ` for ${await teamOfOrgLabel(orgId, teamId)}` : '';
  return `Read who is invited to ${await orgLabel(orgId)}${only}`;
}

/**
 * @param orgId - The org
 * @param email - Who is invited
 * @param role - With what role
 * @param teamId - To this team as well, if given
 */
export async function invitationCreate(
  orgId: string,
  email: string,
  role: string,
  teamId?: string,
): Promise<string> {
  const team = teamId ? ` and ${await teamOfOrgLabel(orgId, teamId)}` : '';
  return `Invite ${quoted(email)} to ${await orgLabel(orgId)}${team} as ${role}`;
}

/**
 * @param orgId - The org in the path
 * @param invitationId - The invitation
 */
export async function invitationRevoke(orgId: string, invitationId: string): Promise<string> {
  const invitation = await findOrThrow(
    prisma.invitation.findFirst({
      where: { id: invitationId, orgId },
      select: { email: true, role: true, status: true },
    }),
    ERR.INVITATION_NOT_FOUND,
  );
  return (
    `Revoke the ${invitation.status.toLowerCase()} invitation of ${quoted(invitation.email)} ` +
    `as ${invitation.role} to ${await orgLabel(orgId)}`
  );
}

/**
 * @param orgId - The org
 * @param name - The new team's name
 * @param slug - Its slug
 * @param description - Its description, if any
 */
export async function teamCreate(
  orgId: string,
  name: string,
  slug: string,
  description?: string,
): Promise<string> {
  return `Create the team ${slug} ${quoted(name)} in ${await orgLabel(orgId)}${withDescription(description)}`;
}

/**
 * @param teamId - The team
 * @param fields - What changes
 */
export async function teamUpdate(
  teamId: string,
  fields: Record<string, string | undefined>,
): Promise<string> {
  return `In ${await teamLabel(teamId)}, set ${changeList(fields)}`;
}

/** @param teamId - The team */
export async function teamDelete(teamId: string): Promise<string> {
  const label = await teamLabel(teamId);
  const [projects, spaces, members] = await Promise.all([
    prisma.project.count({ where: { teamId } }),
    prisma.wikiSpace.count({ where: { teamId } }),
    prisma.teamMembership.count({ where: { teamId } }),
  ]);
  return (
    `Delete ${label} with everything in it. As of this request that is ` +
    `${amount(projects, 'project')}, ${amount(spaces, 'wiki space')} and ${amount(members, 'member')}`
  );
}

/**
 * The role a user holds in a team.
 * @param teamId - The team
 * @param userId - The user
 */
async function teamRoleOf(teamId: string, userId: string): Promise<string> {
  const membership = await findOrThrow(
    prisma.teamMembership.findFirst({ where: { teamId, userId }, select: { role: true } }),
    'Team membership not found',
  );
  return membership.role;
}

/**
 * @param viewerId - Who asks
 * @param teamId - The team
 * @param userId - Who joins
 * @param role - With what role
 */
export async function teamMemberAdd(
  viewerId: string,
  teamId: string,
  userId: string,
  role: string,
): Promise<string> {
  return `Add ${await userLabel(viewerId, userId)} to ${await teamLabel(teamId)} as ${role}`;
}

/**
 * @param viewerId - Who asks
 * @param teamId - The team
 * @param memberId - The user
 * @param role - The new role
 */
export async function teamMemberUpdate(
  viewerId: string,
  teamId: string,
  memberId: string,
  role: string,
): Promise<string> {
  const current = await teamRoleOf(teamId, memberId);
  return `Change ${await userLabel(viewerId, memberId)} in ${await teamLabel(teamId)} from ${current} to ${role}`;
}

/**
 * @param viewerId - Who asks
 * @param teamId - The team
 * @param memberId - The user
 */
export async function teamMemberRemove(
  viewerId: string,
  teamId: string,
  memberId: string,
): Promise<string> {
  const current = await teamRoleOf(teamId, memberId);
  return `Remove ${await userLabel(viewerId, memberId)}, now ${current}, from ${await teamLabel(teamId)}`;
}

/**
 * @param teamId - The team
 * @param fields - The new project
 * @param fields.name - Its name
 * @param fields.slug - Its slug
 * @param fields.prefix - Its prefix
 * @param fields.description - Its description, if any
 */
export async function projectCreate(
  teamId: string,
  fields: { name: string; slug: string; prefix: string; description?: string },
): Promise<string> {
  const { name, slug, prefix, description } = fields;
  return `Create the project ${prefix} ${quoted(name)} with slug ${slug} in ${await teamLabel(teamId)}${withDescription(description)}`;
}

/**
 * A project as a preview names it.
 * @param projectId - The project
 */
async function projectLabel(projectId: string): Promise<string> {
  const project = await findOrThrow(
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, prefix: true },
    }),
    ERR.PROJECT_NOT_FOUND,
  );
  return `project ${project.prefix} ${quoted(project.name)}`;
}

/**
 * @param projectId - The project
 * @param fields - What changes
 */
export async function projectUpdate(
  projectId: string,
  fields: Record<string, string | null | undefined>,
): Promise<string> {
  return `In ${await projectLabel(projectId)}, set ${changeList(fields)}`;
}

/** @param projectId - The project */
export async function projectDelete(projectId: string): Promise<string> {
  const label = await projectLabel(projectId);
  const issues = await prisma.issue.count({ where: { projectId } });
  return `Delete ${label} with its ${amount(issues, 'issue')}, as of this request`;
}

/**
 * @param teamId - The team
 * @param name - The new space's name
 * @param slug - Its slug
 * @param description - Its description, if any
 */
export async function spaceCreate(
  teamId: string,
  name: string,
  slug: string,
  description?: string,
): Promise<string> {
  return `Create the wiki space ${slug} ${quoted(name)} in ${await teamLabel(teamId)}${withDescription(description)}`;
}

/**
 * @param spaceId - The space
 * @param fields - What changes
 */
export async function spaceUpdate(
  spaceId: string,
  fields: Record<string, string | boolean | null | undefined>,
): Promise<string> {
  return `In ${await spaceLabel(spaceId)}, set ${changeList(fields)}`;
}

/** @param spaceId - The space */
export async function spacePermissionList(spaceId: string): Promise<string> {
  return `Read who holds which permission on ${await spaceLabel(spaceId)}`;
}

/**
 * @param viewerId - Who asks
 * @param spaceId - The space
 * @param grant - Who gets what
 * @param grant.userId - One user, or
 * @param grant.teamRole - Everyone with this team role
 * @param grant.level - The level
 */
export async function spacePermissionSet(
  viewerId: string,
  spaceId: string,
  grant: { userId?: string; teamRole?: string; level: string },
): Promise<string> {
  const who = grant.userId
    ? await userLabel(viewerId, grant.userId)
    : `every team ${grant.teamRole}`;
  return `Give ${who} the permission ${grant.level} on ${await spaceLabel(spaceId)}`;
}

/**
 * @param viewerId - Who asks
 * @param spaceId - The space in the path
 * @param permissionId - The permission
 */
export async function spacePermissionRemove(
  viewerId: string,
  spaceId: string,
  permissionId: string,
): Promise<string> {
  const permission = await findOrThrow(
    prisma.spacePermission.findFirst({
      where: { id: permissionId, spaceId },
      select: { userId: true, teamRole: true, level: true },
    }),
    ERR.PERMISSION_NOT_FOUND,
  );
  const who = permission.userId
    ? await userLabel(viewerId, permission.userId)
    : `every team ${permission.teamRole}`;
  return `Take the permission ${permission.level} of ${who} off ${await spaceLabel(spaceId)}`;
}

/** @param pageId - The page */
export async function pageRestrictionGet(pageId: string): Promise<string> {
  return `Read who the ${await pageLabel(pageId)} is restricted to`;
}

/**
 * @param viewerId - Who asks
 * @param pageId - The page
 * @param type - VIEW or EDIT
 * @param userIds - Who it is restricted to from now on
 */
export async function pageRestrictionSet(
  viewerId: string,
  pageId: string,
  type: string,
  userIds: string[],
): Promise<string> {
  const label = await pageLabel(pageId);
  if (userIds.length === 0) return `Lift the ${type} restrictions of the ${label}`;
  const usernames = await visibleUsernames(viewerId, userIds);
  const names = userIds.map((id) => {
    const username = usernames.get(id);
    return username ? `${username} ${shortId(id)}` : shortId(id);
  });
  return `Replace the ${type} restrictions of the ${label}: only ${keyList(names)}`;
}

/**
 * @param viewerId - Who asks
 * @param restrictionId - The restriction
 */
export async function pageRestrictionRemove(
  viewerId: string,
  restrictionId: string,
): Promise<string> {
  const restriction = await findOrThrow(
    prisma.pageRestriction.findUnique({
      where: { id: restrictionId },
      select: { type: true, pageId: true, userId: true, teamRoleMin: true },
    }),
    ERR.RESTRICTION_NOT_FOUND,
  );
  const who = restriction.userId
    ? await userLabel(viewerId, restriction.userId)
    : `team role ${restriction.teamRoleMin}`;
  return `Take ${who} off the ${restriction.type} restrictions of the ${await pageLabel(restriction.pageId)}`;
}

/**
 * Names the reach of a new token, as a person can only judge it by that.
 * @param name - Its name
 * @param scopes - Its scopes
 * @param expiresInDays - After how many days it expires, if ever
 */
export function tokenCreate(
  name: string,
  scopes: string[],
  expiresInDays?: number,
): Promise<string> {
  const expiry = expiresInDays
    ? `It expires in ${amount(expiresInDays, 'day')}`
    : 'It never expires';
  return Promise.resolve(
    `Create an API token ${quoted(name)} with the scopes ${scopes.join(', ')}. ${expiry}. ` +
      'You get the token once, here, and hand it over yourself',
  );
}

/**
 * Only the caller's own token: another's answers 404, as the service does.
 * @param userId - Whose token
 * @param tokenId - The token
 * @param askingTokenId - The token that asks, if a token does
 */
export async function tokenRevoke(
  userId: string,
  tokenId: string,
  askingTokenId?: string,
): Promise<string> {
  const token = await findOrThrow(
    prisma.apiToken.findFirst({
      where: { id: tokenId, userId },
      select: { name: true, prefix: true, scopes: true },
    }),
    'API token not found',
  );
  const self =
    tokenId === askingTokenId
      ? '. This is the token asking: it stops working, and its open requests fail'
      : '';
  return `Revoke the API token ${token.prefix}... ${quoted(token.name)} with the scopes ${token.scopes.join(', ')}${self}`;
}

/** The numbers of the whole installation. */
export function adminStats(): Promise<string> {
  return Promise.resolve('Read the totals of this installation: users, organizations, storage');
}

/** The settings of the whole installation. */
export function adminSettings(): Promise<string> {
  return Promise.resolve('Read the settings of this installation');
}

/** @param search - The text to look for, if any */
export function adminUserList(search?: string): Promise<string> {
  const only = search ? ` matching ${quoted(search)}` : '';
  return Promise.resolve(`Read the users of this installation${only}, with their email addresses`);
}

/** @param userId - The user */
export async function adminUserGet(userId: string): Promise<string> {
  return `Read the account of ${await adminTargetLabel(userId)}, with their email address and memberships`;
}

/**
 * What adminService.updateUser does with the input: only the role, and in every org at once.
 * @param userId - The user
 * @param role - The new role, if given
 */
export async function adminUserUpdate(userId: string, role?: string): Promise<string> {
  const label = await adminTargetLabel(userId);
  if (!role) return `Change nothing about ${label}: only a role takes effect here`;
  const orgs = await prisma.orgMembership.count({ where: { userId } });
  return `Make ${label} ${role} in every organization they are in: ${amount(orgs, 'organization')} as of this request`;
}

/** @param userId - The user */
export async function adminUserDelete(userId: string): Promise<string> {
  const label = await adminTargetLabel(userId);
  const [orgs, tokens] = await Promise.all([
    prisma.orgMembership.count({ where: { userId } }),
    prisma.apiToken.count({ where: { userId } }),
  ]);
  return (
    `Delete the account of ${label}. As of this request they are in ` +
    `${amount(orgs, 'organization')} and hold ${amount(tokens, 'API token')}`
  );
}

/** @param userId - The user */
export async function adminUserDeactivate(userId: string): Promise<string> {
  return `Deactivate ${await adminTargetLabel(userId)}: they can no longer sign in or use a token`;
}

/** @param userId - The user */
export async function adminUserReactivate(userId: string): Promise<string> {
  return `Reactivate ${await adminTargetLabel(userId)}: they can sign in again`;
}

/**
 * @param filters - What the read is limited to
 * @param filters.userId - Rows of this user
 * @param filters.resourceType - Rows of this resource
 * @param filters.action - Rows of this action
 */
export function auditLogList(filters: {
  userId?: string;
  resourceType?: string;
  action?: string;
}): Promise<string> {
  const only = Object.entries(filters)
    .filter(([, value]) => value)
    .map(([field, value]) => `${field} ${quoted(value as string)}`);
  return Promise.resolve(
    `Read the audit log of this installation${only.length > 0 ? `, limited to ${only.join(', ')}` : ''}`,
  );
}

/**
 * Only that the row exists: what it holds is the read that waits (A14).
 * @param id - The row
 */
export async function auditLogGet(id: string): Promise<string> {
  await findOrThrow(
    prisma.auditLog.findUnique({ where: { id }, select: { id: true } }),
    'Audit log not found',
  );
  return `Read the audit row ${shortId(id)}`;
}
