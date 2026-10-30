/**
 * Authorization for realtime rooms. A socket may only join a room when the REST API
 * would let the same user read what that room broadcasts.
 *
 * Access is checked when the socket subscribes, and again for held rooms whenever access
 * is taken away (see access-revocation.ts): member removal, role changes, space permission
 * and page restriction changes all re-check live connections.
 */
import { prisma } from '../config/database';
import { checkWikiSpaceOrgAccess } from '../middleware/rbac';
import { checkProjectAccess } from '../middleware/requireProjectAccess';
import { canAccessSpace } from '../modules/wiki/space-permissions.service';

/** Most rooms one subscribe message may ask for; the rest of the request is refused. */
export const MAX_ROOMS_PER_REQUEST = 50;
/** Most rooms one socket may hold or have pending, including its own user room. */
export const MAX_ROOMS_PER_SOCKET = 50;

const ROOM_PATTERN = /^(user|project|space|issue):([A-Za-z0-9_-]{1,64})$/;

/**
 * Decide whether a user may join a room.
 * - `user:<id>`: only the user's own id
 * - `project:<id>`: the user can view the project (team member or system admin)
 * - `space:<id>`: org member and VIEW access to the space, as on `GET /api/wiki/spaces/:id`
 * - `issue:<id>`: the user can view the issue's project
 *
 * Unknown prefixes, malformed ids and ids that don't exist are refused.
 * @param userId - The socket's authenticated user
 * @param room - The requested room name
 * @returns True when the room may be joined
 */
export async function canJoinRoom(userId: string, room: string): Promise<boolean> {
  const match = ROOM_PATTERN.exec(room);
  if (!match) return false;
  const [, kind, id] = match;

  switch (kind) {
    case 'user':
      return id === userId;
    case 'project':
      return (await checkProjectAccess(userId, id)) === 'ok';
    case 'space':
      return (
        (await checkWikiSpaceOrgAccess(id, userId)) === 'ok' &&
        (await canAccessSpace(id, userId, 'VIEW'))
      );
    case 'issue': {
      const issue = await prisma.issue.findUnique({ where: { id }, select: { projectId: true } });
      if (!issue) return false;
      return (await checkProjectAccess(userId, issue.projectId)) === 'ok';
    }
    default:
      return false;
  }
}
