/**
 * What an approver reads before a dashboard or saved query is shared differently: who sees it
 * now, who will, built from the database. Names are data, quoted and bounded.
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

/**
 * @param id - The dashboard
 * @param next - The sharing in the input
 */
export async function dashboardSharing(id: string, next: Sharing): Promise<string> {
  const row = await findOrThrow(
    prisma.dashboard.findUnique({
      where: { id },
      select: { name: true, owner: { select: { username: true } }, ...SHARING_SELECT },
    }),
    'Dashboard not found',
  );
  return (
    `Change who can open the dashboard ${quoted(row.name)} #${id.slice(-8)} by ` +
    `${row.owner.username}: shared with ${sharedWith(row)} as of this request, ` +
    `to ${await nextSharing(next)}`
  );
}

/**
 * @param id - The saved query
 * @param next - The sharing in the input
 */
export async function savedQuerySharing(id: string, next: Sharing): Promise<string> {
  const row = await findOrThrow(
    prisma.savedFilter.findUnique({
      where: { id },
      select: { name: true, user: { select: { username: true } }, ...SHARING_SELECT },
    }),
    'Saved query not found',
  );
  return (
    `Change who can open the saved query ${quoted(row.name)} #${id.slice(-8)} by ` +
    `${row.user.username}: shared with ${sharedWith(row)} as of this request, ` +
    `to ${await nextSharing(next)}`
  );
}
