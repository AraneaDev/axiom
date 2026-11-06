import type { GithubRepoLink } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

import { requireGithubAccount } from './github-actor';
import { getStatus } from './github-app.service';
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

type GithubRepoInstallation = { id: number };

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
 * How many issues of a link have GitHub branches, pull requests or checks to lose when it is
 * unlinked. Nothing records those until the issue links exist, so this is 0 for now.
 * @param _linkId The link
 */
export async function countLinkedIssues(_linkId: string): Promise<number> {
  return 0;
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
  return link ? present(link) : null;
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
  const path = `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`;

  const { data: repository } = await githubRequest<GithubRepository>(
    { kind: 'user', userId },
    'GET',
    path,
  );
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

  if (await findRepoLinkByProject(projectId)) {
    throw new AppError(
      409,
      'This project is already linked to a repository. Unlink it first.',
      'GITHUB_PROJECT_LINKED',
    );
  }
  const repoLinkedElsewhere = () =>
    new AppError(409, 'This repository is linked to another project', 'GITHUB_REPO_LINKED');
  if (await findRepoLinkByRepoId(repository.id)) throw repoLinkedElsewhere();

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
    return present(link);
  } catch (err) {
    // Two links racing for one project or one repository: the unique indexes decide
    if ((err as { code?: string }).code === 'P2002') {
      const target = JSON.stringify((err as { meta?: unknown }).meta ?? '');
      if (target.includes('projectId')) {
        throw new AppError(
          409,
          'This project is already linked to a repository. Unlink it first.',
          'GITHUB_PROJECT_LINKED',
        );
      }
      throw repoLinkedElsewhere();
    }
    throw err;
  }
}

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
