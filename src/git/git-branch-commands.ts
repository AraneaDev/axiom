import { git } from './git-core';

export interface BranchInfo {
  name: string;
  sha: string;
  isDefault: boolean;
}

/**
 *
 * @param repoPath
 * @param defaultBranch
 */
export async function listBranches(repoPath: string, defaultBranch: string): Promise<BranchInfo[]> {
  const stdout = await git(
    ['for-each-ref', '--format=%(refname:short) %(objectname:short)', 'refs/heads/'],
    { cwd: repoPath },
  );
  if (!stdout.trim()) return [];
  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [name, sha] = line.split(' ');
      return { name, sha, isDefault: name === defaultBranch };
    });
}

/**
 *
 * @param repoPath
 * @param branch
 */
export async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', `refs/heads/${branch}`], { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}

/**
 *
 * @param repoPath
 * @param name
 * @param startPoint
 */
export async function createBranch(
  repoPath: string,
  name: string,
  startPoint: string,
): Promise<void> {
  await git(['branch', name, startPoint], { cwd: repoPath });
}

/**
 *
 * @param repoPath
 * @param name
 */
export async function deleteBranch(repoPath: string, name: string): Promise<void> {
  await git(['branch', '-D', name], { cwd: repoPath });
}
