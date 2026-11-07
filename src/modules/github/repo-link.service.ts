import { Prisma, type GithubRepoLink } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

import { applyDefaultGithubRules } from './default-rules';
import { requireGithubAccount } from './github-actor';
import { getGithubAppSecrets, getStatus, githubAppGeneration } from './github-app.service';
import { githubRequest } from './github-client';
import { githubIdJson } from './github-errors';

type GithubRepository = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  owner: { login: string };
  permissions?: { admin?: boolean };
};

type GithubRepoInstallation = {
  id: number;
  suspended_at?: string | null;
  account?: { login?: string; type?: string } | null;
};

/**
 * The link of a GitHub repository, by the id GitHub gave it.
 * @param repoId GitHub's repository id
 */
export async function findRepoLinkByRepoId(repoId: number): Promise<GithubRepoLink | null> {
  return prisma.githubRepoLink.findUnique({ where: { repoId: BigInt(repoId) } });
}

/**
 * The link of a project.
 * @param projectId The project
 */
export async function findRepoLinkByProject(projectId: string): Promise<GithubRepoLink | null> {
  return prisma.githubRepoLink.findUnique({ where: { projectId } });
}

/**
 * How many issues of a link have GitHub branches, pull requests or commits to lose when it is
 * unlinked: the distinct issues its issue links name.
 * @param linkId The link
 */
export async function countLinkedIssues(linkId: string): Promise<number> {
  const rows = await prisma.githubIssueLink.findMany({
    where: { repoLinkId: linkId },
    distinct: ['issueId'],
    select: { issueId: true },
  });
  return rows.length;
}

/**
 * Whether the installation a link reads through can be read with: known, not removed and not
 * suspended. A link whose App is gone or suspended fails every call.
 * @param installationId The link's installation
 * @returns `usable`, `missing` (unknown or removed) or `suspended`
 */
export async function installationState(
  installationId: bigint,
): Promise<'usable' | 'missing' | 'suspended'> {
  const row = await prisma.githubInstallation.findUnique({
    where: { id: installationId },
    select: { removedAt: true, suspendedAt: true },
  });
  if (!row || row.removedAt !== null) return 'missing';
  return row.suspendedAt !== null ? 'suspended' : 'usable';
}

/**
 * A link as the actions answer it. `linkedBy` is null when that person is gone.
 * @param link The stored link
 */
async function present(link: GithubRepoLink) {
  const user = await prisma.user.findUnique({
    where: { id: link.linkedById },
    select: { id: true, username: true, displayName: true },
  });
  return {
    id: link.id,
    projectId: link.projectId,
    repoId: githubIdJson(link.repoId),
    installationId: githubIdJson(link.installationId),
    repoFullName: link.fullName,
    owner: link.owner,
    name: link.name,
    htmlUrl: link.htmlUrl,
    defaultBranch: link.defaultBranch,
    linkedBy: user,
    createdAt: link.createdAt,
  };
}

/**
 * The repository a project is linked to, or null.
 * @param projectId The project
 */
export async function getRepoLink(projectId: string) {
  const link = await findRepoLinkByProject(projectId);
  // The count lets the unlink dialog say what it takes away
  return link
    ? { ...(await present(link)), linkedIssueCount: await countLinkedIssues(link.id) }
    : null;
}

/**
 * Links a project to a GitHub repository. The person must have admin rights on it on GitHub
 * (checked with their own token), and the App must be installed on it (checked as the App).
 * The caller has already been authorized as an admin of the project's team.
 * @param userId The person linking
 * @param projectId The project
 * @param repo The repository as `owner/name`
 * @throws {AppError} 409 GITHUB_NOT_CONNECTED, 403 GITHUB_NOT_REPO_ADMIN, 409
 * GITHUB_APP_NOT_INSTALLED, GITHUB_PROJECT_LINKED or GITHUB_REPO_LINKED
 */
export async function linkRepo(userId: string, projectId: string, repo: string) {
  await requireGithubAccount(userId);
  // The project's own state, which the caller may see: no GitHub call for an obvious refusal
  if (await findRepoLinkByProject(projectId)) throw projectLinked();
  const path = `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`;

  const { data: repository } = await githubRequest<GithubRepository>(
    { kind: 'user', userId },
    'GET',
    path,
  ).catch(async (err: unknown) => {
    // A person's token reaches a private repository only where the App is installed, so GitHub
    // cannot tell "no such repository" from "not installed": one answer for all three, and no
    // App lookup that would tell a stranger the repository exists
    if (err instanceof AppError && err.statusCode === 404) {
      const { installUrl } = await getStatus();
      throw new AppError(
        409,
        `${repo} was not found, you have no access to it, or the GitHub App is not installed on it`,
        'GITHUB_REPO_UNREACHABLE',
        { installUrl },
      );
    }
    throw err;
  });
  if (repository.permissions?.admin !== true) {
    throw new AppError(
      403,
      `Linking needs admin rights on ${repo} on GitHub`,
      'GITHUB_NOT_REPO_ADMIN',
    );
  }

  const installation = await githubRequest<GithubRepoInstallation>(
    { kind: 'app' },
    'GET',
    `${path}/installation`,
  ).catch(async (err: unknown) => {
    // Only a public repository gets here without the App installed
    if (err instanceof AppError && err.statusCode === 404) {
      const { installUrl } = await getStatus();
      throw new AppError(
        409,
        `The GitHub App is not installed on ${repo}. Install it, then link again.`,
        'GITHUB_APP_NOT_INSTALLED',
        { installUrl },
      );
    }
    throw err;
  });
  if (installation.data.suspended_at) {
    throw new AppError(
      409,
      `The GitHub App installation for ${repository.owner.login} is suspended`,
      'GITHUB_APP_SUSPENDED',
    );
  }

  if (await findRepoLinkByRepoId(repository.id)) throw repoLinked();

  // The worker reads a link only through a known installation: record the one GitHub just named
  const row = {
    accountLogin: installation.data.account?.login ?? repository.owner.login,
    accountType: installation.data.account?.type ?? 'Organization',
    suspendedAt: installation.data.suspended_at ? new Date(installation.data.suspended_at) : null,
    removedAt: null,
    lastEventAt: new Date(),
  };
  await prisma.githubInstallation.upsert({
    where: { id: BigInt(installation.data.id) },
    update: row,
    create: { id: BigInt(installation.data.id), ...row },
  });

  try {
    const link = await prisma.githubRepoLink.create({
      data: {
        projectId,
        repoId: BigInt(repository.id),
        installationId: BigInt(installation.data.id),
        owner: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        defaultBranch: repository.default_branch,
        htmlUrl: repository.html_url,
        linkedById: userId,
      },
    });
    // Before the first reconcile, which may find pull requests the rules should already see. A
    // failure is logged and left for the next deploy's migrate step; it never undoes the link.
    await applyDefaultGithubRules(link.id).catch((err: unknown) => {
      logger.warn('default github rules not created', {
        projectId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
    return present(link);
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    // Two links raced; the unique indexes decided. Ask which one this project lost to.
    throw (await findRepoLinkByProject(projectId)) ? projectLinked() : repoLinked();
  }
}

const projectLinked = () =>
  new AppError(
    409,
    'This project is already linked to a repository. Unlink it first.',
    'GITHUB_PROJECT_LINKED',
  );
const repoLinked = () =>
  new AppError(409, 'This repository is linked to another project', 'GITHUB_REPO_LINKED');

/**
 * Removes a project's link. What the later GitHub tables hold for it cascades from the row.
 * @param projectId The project
 */
export async function unlinkRepo(projectId: string): Promise<{ unlinked: boolean }> {
  const { count } = await prisma.githubRepoLink.deleteMany({ where: { projectId } });
  if (count === 0) {
    throw new AppError(404, 'This project is not linked to a GitHub repository', 'NOT_FOUND');
  }
  return { unlinked: true };
}

// Whether the App's secrets open, kept per App generation: answering a health read must not
// decrypt the private key each time. A replaced or re-created App is a new generation.
let secretsReadable: { generation: string; unreadable: boolean } | null = null;

async function appSecretUnreadable(): Promise<boolean> {
  const generation = await githubAppGeneration();
  if (generation === null) return false;
  if (secretsReadable?.generation === generation) return secretsReadable.unreadable;
  const unreadable = await getGithubAppSecrets().then(
    () => false,
    (err: unknown) => err instanceof AppError && err.code === 'GITHUB_SECRET_UNREADABLE',
  );
  secretsReadable = { generation, unreadable };
  return unreadable;
}

const HEALTH_WINDOW_MS = 7 * 24 * 60 * 60_000;
const HEALTH_FAILURES = 20;

/**
 * How a project's link is doing: whether the App still reaches the repository, when GitHub last
 * told us something and when we last asked, and the webhook deliveries of this repository that
 * failed in the last 7 days (newest 20). Never a payload.
 * @param projectId The project
 */
export async function getLinkHealth(projectId: string) {
  const link = await findRepoLinkByProject(projectId);
  const secretsUnreadable = await appSecretUnreadable();
  if (!link) {
    return {
      linked: false,
      appInstalled: false,
      installationRemoved: false,
      installationSuspended: false,
      appSecretUnreadable: secretsUnreadable,
      lastDeliveryAt: null,
      lastReconciledAt: null,
      lastReconcileError: null,
      reconcileComplete: true,
      reconcileIncompleteReason: null,
      recentFailures: [],
    };
  }
  const [installation, failures] = await Promise.all([
    prisma.githubInstallation.findUnique({ where: { id: link.installationId } }),
    prisma.githubDelivery.findMany({
      where: {
        repoId: link.repoId,
        status: 'FAILED',
        receivedAt: { gte: new Date(Date.now() - HEALTH_WINDOW_MS) },
      },
      orderBy: { receivedAt: 'desc' },
      take: HEALTH_FAILURES,
      select: {
        id: true,
        event: true,
        action: true,
        error: true,
        attempts: true,
        receivedAt: true,
      },
    }),
  ]);
  return {
    linked: true,
    repoFullName: link.fullName,
    appInstalled: installation !== null && installation.removedAt === null,
    installationRemoved: installation?.removedAt != null,
    installationSuspended: installation?.suspendedAt != null,
    appSecretUnreadable: secretsUnreadable,
    lastDeliveryAt: link.lastDeliveryAt?.toISOString() ?? null,
    lastReconciledAt: link.lastReconciledAt?.toISOString() ?? null,
    lastReconcileError: link.lastReconcileError,
    reconcileComplete: link.lastReconcileNote === null,
    reconcileIncompleteReason: link.lastReconcileNote,
    recentFailures: failures.map((f) => ({
      deliveryId: f.id,
      event: f.event,
      action: f.action,
      error: f.error,
      attempts: f.attempts,
      receivedAt: f.receivedAt.toISOString(),
    })),
  };
}
