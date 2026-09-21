import type { Repository } from '@prisma/client';

import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { ERR } from '../utils/error-messages';

/**
 * Resolve a repository by slugs and check that the user may read it, or write to it
 * when `needsWrite` is set. Shared by the smart HTTP and SSH transports.
 * @param userId - Authenticated user
 * @param orgSlug - Organization slug
 * @param teamSlug - Team slug
 * @param repoSlug - Repository slug without `.git`
 * @param needsWrite - True for git-receive-pack
 * @returns The repository, guaranteed to have a disk path
 * @throws {AppError} 404 when not found, 403 when access is denied
 */
export async function resolveRepoForGit(
  userId: string,
  orgSlug: string,
  teamSlug: string,
  repoSlug: string,
  needsWrite: boolean,
): Promise<Repository & { diskPath: string }> {
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw new AppError(404, ERR.REPOSITORY_NOT_FOUND);

  const team = await prisma.team.findUnique({
    where: { orgId_slug: { orgId: org.id, slug: teamSlug } },
  });
  if (!team) throw new AppError(404, ERR.REPOSITORY_NOT_FOUND);

  const repo = await prisma.repository.findUnique({
    where: { teamId_slug: { teamId: team.id, slug: repoSlug } },
  });
  if (!repo || !repo.diskPath) throw new AppError(404, ERR.REPOSITORY_NOT_FOUND);

  const orgMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: org.id } },
  });

  if (!orgMembership && repo.visibility === 'PRIVATE') {
    throw new AppError(403, ERR.ACCESS_DENIED);
  }

  if (needsWrite) {
    if (!orgMembership || orgMembership.role === 'VIEWER' || orgMembership.role === 'GUEST') {
      throw new AppError(403, 'Write access denied');
    }
  }

  return { ...repo, diskPath: repo.diskPath };
}
