import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

import { GITHUB_INTEGRATION_USER_ID } from './integration-user';

/** Who a GitHub event or call stands for in Axiom */
export type GithubActor = {
  userId: string;
  login: string;
  /** Whether the GitHub user is a connected Axiom user */
  mapped: boolean;
};

/** The login GitHub shows for an account that no longer exists */
const GHOST_LOGIN = 'ghost';

/**
 * The connected GitHub account of an Axiom user. There is no fallback to the integration user: a
 * write made for a person is made as that person (G3).
 * @param userId The Axiom user
 * @returns The GitHub id and login
 * @throws {AppError} 409 GITHUB_NOT_CONNECTED
 */
export async function requireGithubAccount(
  userId: string,
): Promise<{ githubUserId: number; login: string }> {
  const account = await prisma.githubAccount.findUnique({
    where: { userId },
    select: { githubUserId: true, login: true },
  });
  if (!account) {
    throw new AppError(
      409,
      'Connect your GitHub account in Settings first',
      'GITHUB_NOT_CONNECTED',
    );
  }
  return { githubUserId: Number(account.githubUserId), login: account.login };
}

/**
 * The Axiom user a GitHub user acts as: the one who connected that GitHub id, else the
 * integration user. The login is the one GitHub sent, so the activity keeps who really did it.
 * @param github The GitHub user of an event, or null when GitHub sent none (a deleted account)
 */
export async function resolveGithubActor(
  github: { id: number; login: string } | null,
): Promise<GithubActor> {
  if (!github) return { userId: GITHUB_INTEGRATION_USER_ID, login: GHOST_LOGIN, mapped: false };
  const account = await prisma.githubAccount.findUnique({
    where: { githubUserId: github.id },
    select: { userId: true },
  });
  return account
    ? { userId: account.userId, login: github.login, mapped: true }
    : { userId: GITHUB_INTEGRATION_USER_ID, login: github.login, mapped: false };
}

/**
 * Who a GitHub user writes as in a project: the mapped user when they are a member of the
 * project's org, else the integration user. A connected account alone never lets someone write
 * into an org they do not belong to.
 * @param actor The resolved GitHub actor
 * @param projectId The project written to
 * @returns The Axiom user id
 */
export async function orgActorId(actor: GithubActor, projectId: string): Promise<string> {
  if (!actor.mapped) return GITHUB_INTEGRATION_USER_ID;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { orgId: true } } },
  });
  if (!project) return GITHUB_INTEGRATION_USER_ID;
  const member = await prisma.orgMembership.findFirst({
    where: { userId: actor.userId, orgId: project.team.orgId },
    select: { id: true },
  });
  return member ? actor.userId : GITHUB_INTEGRATION_USER_ID;
}
