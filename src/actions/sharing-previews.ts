/**
 * What an approver reads before a dashboard or saved query is changed, and above all before it is
 * shared differently: each field the call sets, and who sees it now and who will, from the database. Names are data, quoted and bounded.
 */
import { prisma } from '../config/database';
import { findOrThrow } from '../utils/find-or-throw';

const MAX_NAME_LENGTH = 80;

interface Sharing {
  visibility?: 'PRIVATE' | 'TEAM' | 'ORG';
  teamId?: string;
  orgId?: string;
}

/**
 * Text an agent may have written, on one line.
 * @param text - The text
 */
function quoted(text: string): string {
  const line = text.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  return line.length > MAX_NAME_LENGTH ? `"${line.slice(0, MAX_NAME_LENGTH)}..."` : `"${line}"`;
}

/**
 * Who a record is shared with, as words.
 * @param row - Its sharing columns, with the team and org names
 * @param row.visibility
 * @param row.team
 * @param row.org
 */
function sharedWith(row: {
  visibility: string;
  team: { name: string; org: { slug: string } } | null;
  org: { name: string; slug: string } | null;
}): string {
  if (row.visibility === 'TEAM' && row.team) {
    return `team ${quoted(row.team.name)} of ${row.team.org.slug}`;
  }
  if (row.visibility === 'ORG' && row.org) return `organization ${row.org.slug}`;
  return row.visibility === 'PRIVATE' ? 'only its owner' : row.visibility;
}

/**
 * Who the new sharing names, as words.
 * @param next - The sharing in the input
 */
async function nextSharing(next: Sharing): Promise<string> {
  const [team, org] = await Promise.all([
    next.teamId
      ? prisma.team.findUnique({
          where: { id: next.teamId },
          select: { name: true, org: { select: { slug: true } } },
        })
      : null,
    next.orgId
      ? prisma.organization.findUnique({
          where: { id: next.orgId },
          select: { name: true, slug: true },
        })
      : null,
  ]);
  const parts = [
    next.visibility ? `visibility ${next.visibility}` : undefined,
    team ? `team ${quoted(team.name)} of ${team.org.slug}` : undefined,
    org ? `organization ${org.slug}` : undefined,
  ].filter((part) => part !== undefined);
  return parts.length > 0 ? parts.join(', ') : 'unchanged';
}

const SHARING_SELECT = {
  visibility: true,
  team: { select: { name: true, org: { select: { slug: true } } } },
  org: { select: { name: true, slug: true } },
} as const;

interface UpdateInput extends Sharing {
  name?: string;
  description?: string | null;
  layout?: unknown;
  query?: Record<string, string>;
  text?: string;
}

/**
 * What an update sets besides sharing, one phrase per field the call names.
 * @param input - The update's input
 */
function fieldsSet(input: UpdateInput): string[] {
  const set: string[] = [];
  if (input.name !== undefined) set.push(`the name to ${quoted(input.name)}`);
  if (input.description !== undefined) {
    set.push(
      input.description === null
        ? 'the description (cleared)'
        : `the description to ${quoted(input.description)}`,
    );
  }
  if (input.layout !== undefined) set.push('the layout');
  if (input.text !== undefined) set.push(`the query to ${quoted(input.text)}`);
  if (input.query !== undefined) set.push(`the query to ${quoted(JSON.stringify(input.query))}`);
  return set;
}

/**
 * The sentence of an update: each field it sets, and sharing only when it changes.
 * @param what - dashboard or saved query
 * @param row - The record as it is now
 * @param row.name
 * @param row.who
 * @param id - Its id
 * @param input - The update's input
 * @param sharing - The current sharing, as words
 */
async function updateSentence(
  what: string,
  row: { name: string; who: string },
  id: string,
  input: UpdateInput,
  sharing: string,
): Promise<string> {
  const parts = fieldsSet(input);
  const { visibility, teamId, orgId } = input;
  if (visibility !== undefined || teamId !== undefined || orgId !== undefined) {
    parts.push(
      `who can open it: shared with ${sharing} as of this request, to ${await nextSharing(input)}`,
    );
  }
  return `Change the ${what} ${quoted(row.name)} #${id.slice(-8)} by ${row.who}: set ${parts.join('; ')}`;
}

/**
 * @param id - The dashboard
 * @param input - The update's input
 */
export async function dashboardUpdate(id: string, input: UpdateInput): Promise<string> {
  const row = await findOrThrow(
    prisma.dashboard.findUnique({
      where: { id },
      select: { name: true, owner: { select: { username: true } }, ...SHARING_SELECT },
    }),
    'Dashboard not found',
  );
  return updateSentence(
    'dashboard',
    { name: row.name, who: row.owner.username },
    id,
    input,
    sharedWith(row),
  );
}

/**
 * @param id - The saved query
 * @param input - The update's input
 */
export async function savedQueryUpdate(id: string, input: UpdateInput): Promise<string> {
  const row = await findOrThrow(
    prisma.savedFilter.findUnique({
      where: { id },
      select: { name: true, user: { select: { username: true } }, ...SHARING_SELECT },
    }),
    'Saved query not found',
  );
  return updateSentence(
    'saved query',
    { name: row.name, who: row.user.username },
    id,
    input,
    sharedWith(row),
  );
}
