import { git, validateRef, validateSha } from './git-core';

/**
 *
 * @param repoPath
 * @param base
 * @param head
 */
export async function diff(repoPath: string, base: string, head: string): Promise<string> {
  validateRef(base);
  validateRef(head);
  return git(['diff', base, head], { cwd: repoPath });
}

/**
 *
 * @param repoPath
 * @param sha
 */
export async function diffCommit(repoPath: string, sha: string): Promise<string> {
  validateSha(sha);
  return git(['diff-tree', '-p', '--root', sha], { cwd: repoPath });
}

export interface DiffStat {
  file: string;
  additions: number;
  deletions: number;
}

/**
 *
 * @param repoPath
 * @param base
 * @param head
 */
export async function diffStat(repoPath: string, base: string, head: string): Promise<DiffStat[]> {
  validateRef(base);
  validateRef(head);
  const stdout = await git(['diff', '--numstat', base, head], { cwd: repoPath });
  if (!stdout.trim()) return [];
  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [add, del, file] = line.split('\t');
      return {
        file,
        additions: add === '-' ? 0 : parseInt(add, 10),
        deletions: del === '-' ? 0 : parseInt(del, 10),
      };
    });
}

// ─── Merge checks ───────────────────────────────────────────

/**
 *
 * @param repoPath
 * @param a
 * @param b
 */
export async function mergeBase(repoPath: string, a: string, b: string): Promise<string> {
  validateRef(a);
  validateRef(b);
  const stdout = await git(['merge-base', a, b], { cwd: repoPath });
  return stdout.trim();
}

/**
 *
 * @param repoPath
 * @param source
 * @param target
 */
export async function canMerge(repoPath: string, source: string, target: string): Promise<boolean> {
  try {
    const base = await mergeBase(repoPath, source, target);
    const stdout = await git(['merge-tree', base, target, source], { cwd: repoPath });
    return !stdout.includes('<<<<<<');
  } catch {
    return false;
  }
}

// ─── Merge strategies ───────────────────────────────────

/**
 * Perform a squash merge in a worktree directory.
 * Combines all incoming commits into a single commit.
 * @param worktreeDir - path to the checked-out worktree (already on target branch)
 * @param sourceSha - the SHA of the source branch tip
 * @param message - commit message for the squashed commit
 */
export async function squashMerge(
  worktreeDir: string,
  sourceSha: string,
  message: string,
): Promise<void> {
  await git(['-C', worktreeDir, 'merge', '--squash', sourceSha], { cwd: worktreeDir });
  await git(
    [
      '-C',
      worktreeDir,
      '-c',
      'user.name=Axiom',
      '-c',
      'user.email=axiom@local',
      'commit',
      '-m',
      message,
    ],
    { cwd: worktreeDir },
  );
}

/**
 * Perform a rebase merge in a worktree directory.
 * Replays source commits onto the target branch.
 * @param worktreeDir - path to the checked-out worktree (already on target branch)
 * @param sourceSha - the SHA of the source branch tip
 */
export async function rebaseMerge(worktreeDir: string, sourceSha: string): Promise<void> {
  const mergeBaseOut = await git(['merge-base', 'HEAD', sourceSha], { cwd: worktreeDir });
  const base = mergeBaseOut.trim();
  await git(
    [
      '-c',
      'user.name=Axiom',
      '-c',
      'user.email=axiom@local',
      'rebase',
      '--onto',
      'HEAD',
      base,
      sourceSha,
    ],
    { cwd: worktreeDir },
  );
}
