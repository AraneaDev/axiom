import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);

const REPOS_BASE = process.env.REPOS_PATH || '/data/repos';

export function getRepoPath(orgSlug: string, teamSlug: string, repoSlug: string): string {
  return path.join(REPOS_BASE, orgSlug, teamSlug, `${repoSlug}.git`);
}

export async function initBareRepo(repoPath: string, defaultBranch: string = 'main', repoId?: string): Promise<void> {
  await fs.mkdir(repoPath, { recursive: true });
  await execFileAsync('git', ['init', '--bare', '--initial-branch', defaultBranch, repoPath]);

  // Install post-receive hook if repoId provided
  if (repoId) {
    await installPostReceiveHook(repoPath, repoId);
  }
}

export async function installPostReceiveHook(repoPath: string, repoId: string): Promise<void> {
  const { generatePostReceiveHook } = await import('./hook-handler');
  const hookDir = path.join(repoPath, 'hooks');
  await fs.mkdir(hookDir, { recursive: true });
  const hookPath = path.join(hookDir, 'post-receive');
  await fs.writeFile(hookPath, generatePostReceiveHook(repoId));
  await fs.chmod(hookPath, 0o755);
}

export async function deleteRepo(repoPath: string): Promise<void> {
  // Verify it's a git repo before deleting (safety check)
  const headPath = path.join(repoPath, 'HEAD');
  try {
    await fs.access(headPath);
  } catch {
    throw new Error(`Not a git repository: ${repoPath}`);
  }
  await fs.rm(repoPath, { recursive: true, force: true });
}

export async function forkRepo(sourceRepoPath: string, targetRepoPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetRepoPath), { recursive: true });
  await execFileAsync('git', ['clone', '--bare', sourceRepoPath, targetRepoPath]);
}

export async function repoExists(repoPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(repoPath, 'HEAD'));
    return true;
  } catch {
    return false;
  }
}

export async function getRepoSize(repoPath: string): Promise<number> {
  const { stdout } = await execFileAsync('du', ['-sb', repoPath]);
  return parseInt(stdout.split('\t')[0], 10);
}
