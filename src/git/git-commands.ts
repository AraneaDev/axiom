import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

interface ExecOptions {
  cwd: string;
  maxBuffer?: number;
}

async function git(args: string[], opts: ExecOptions): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: opts.cwd,
    maxBuffer: opts.maxBuffer ?? MAX_BUFFER,
  });
  return stdout;
}

// ─── Branches ───────────────────────────────────────────────

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

// ─── Commits ────────────────────────────────────────────────

export interface CommitInfo {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  date: string;
  message: string;
}

/**
 *
 * @param repoPath
 * @param ref
 * @param limit
 * @param skip
 * @param filePath
 */
export async function log(
  repoPath: string,
  ref: string = 'HEAD',
  limit: number = 20,
  skip: number = 0,
  filePath?: string,
): Promise<CommitInfo[]> {
  const format = '%H%n%h%n%an%n%ae%n%aI%n%s';
  const args = ['log', `--format=${format}`, `--skip=${skip}`, `-n`, `${limit}`, ref, '--'];
  if (filePath) args.push(filePath);
  const stdout = await git(args, { cwd: repoPath });
  if (!stdout.trim()) return [];
  const lines = stdout.trim().split('\n');
  const commits: CommitInfo[] = [];
  for (let i = 0; i < lines.length; i += 6) {
    commits.push({
      sha: lines[i],
      shortSha: lines[i + 1],
      author: lines[i + 2],
      authorEmail: lines[i + 3],
      date: lines[i + 4],
      message: lines[i + 5],
    });
  }
  return commits;
}

/**
 *
 * @param repoPath
 * @param sha
 */
export async function getCommit(repoPath: string, sha: string): Promise<CommitInfo | null> {
  try {
    const commits = await log(repoPath, sha, 1);
    return commits[0] ?? null;
  } catch {
    return null;
  }
}

/**
 *
 * @param repoPath
 * @param ref
 */
export async function commitCount(repoPath: string, ref: string = 'HEAD'): Promise<number> {
  try {
    const stdout = await git(['rev-list', '--count', ref], { cwd: repoPath });
    return parseInt(stdout.trim(), 10);
  } catch {
    return 0;
  }
}

// ─── Tree (File Browser) ───────────────────────────────────

export interface TreeEntry {
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  name: string;
  size?: number;
}

/**
 *
 * @param repoPath
 * @param ref
 * @param treePath
 */
export async function lsTree(
  repoPath: string,
  ref: string,
  treePath: string = '',
): Promise<TreeEntry[]> {
  const args = ['ls-tree', '-l', ref];
  if (treePath) args.push('--', treePath.endsWith('/') ? treePath : treePath + '/');

  const stdout = await git(args, { cwd: repoPath });
  if (!stdout.trim()) return [];

  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      // Format: mode SP type SP sha TAB name  (with -l: mode SP type SP sha SP size TAB name)
      const match = line.match(/^(\d+)\s+(blob|tree)\s+([a-f0-9]+)\s+(-|\d+)\t(.+)$/);
      if (!match) return null;
      return {
        mode: match[1],
        type: match[2] as 'blob' | 'tree',
        sha: match[3],
        size: match[4] === '-' ? undefined : parseInt(match[4], 10),
        name: treePath ? match[5].replace(/^.*\//, '') : match[5],
      };
    })
    .filter(Boolean) as TreeEntry[];
}

/**
 *
 * @param repoPath
 * @param ref
 * @param filePath
 */
export async function showBlob(repoPath: string, ref: string, filePath: string): Promise<string> {
  return git(['show', `${ref}:${filePath}`], { cwd: repoPath });
}

/**
 *
 * @param repoPath
 * @param ref
 * @param filePath
 */
export async function blobSize(repoPath: string, ref: string, filePath: string): Promise<number> {
  const stdout = await git(['cat-file', '-s', `${ref}:${filePath}`], { cwd: repoPath });
  return parseInt(stdout.trim(), 10);
}

// ─── Diffs ──────────────────────────────────────────────────

/**
 *
 * @param repoPath
 * @param base
 * @param head
 */
export async function diff(repoPath: string, base: string, head: string): Promise<string> {
  return git(['diff', base, head], { cwd: repoPath });
}

/**
 *
 * @param repoPath
 * @param sha
 */
export async function diffCommit(repoPath: string, sha: string): Promise<string> {
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

// ─── Blame ──────────────────────────────────────────────────

export interface BlameLine {
  sha: string;
  author: string;
  date: string;
  lineNum: number;
  content: string;
}

/**
 *
 * @param repoPath
 * @param ref
 * @param filePath
 */
export async function blame(repoPath: string, ref: string, filePath: string): Promise<BlameLine[]> {
  const stdout = await git(['blame', '--porcelain', ref, '--', filePath], { cwd: repoPath });
  if (!stdout.trim()) return [];

  const lines = stdout.split('\n');
  const result: BlameLine[] = [];
  let currentSha = '';
  let currentAuthor = '';
  let currentDate = '';
  let currentLine = 0;

  for (const line of lines) {
    if (line.match(/^[a-f0-9]{40}/)) {
      const parts = line.split(' ');
      currentSha = parts[0];
      currentLine = parseInt(parts[2], 10);
    } else if (line.startsWith('author ')) {
      currentAuthor = line.slice(7);
    } else if (line.startsWith('author-time ')) {
      currentDate = new Date(parseInt(line.slice(12), 10) * 1000).toISOString();
    } else if (line.startsWith('\t')) {
      result.push({
        sha: currentSha.slice(0, 8),
        author: currentAuthor,
        date: currentDate,
        lineNum: currentLine,
        content: line.slice(1),
      });
    }
  }

  return result;
}

// ─── Tags ───────────────────────────────────────────────────

export interface TagInfo {
  name: string;
  sha: string;
}

/**
 *
 * @param repoPath
 */
export async function listTags(repoPath: string): Promise<TagInfo[]> {
  const stdout = await git(
    ['for-each-ref', '--format=%(refname:short) %(objectname:short)', 'refs/tags/'],
    { cwd: repoPath },
  );
  if (!stdout.trim()) return [];
  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [name, sha] = line.split(' ');
      return { name, sha };
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
    // Use merge-tree to check for conflicts without modifying the repo
    const base = await mergeBase(repoPath, source, target);
    const stdout = await git(['merge-tree', base, target, source], { cwd: repoPath });
    // If there are conflict markers, merge would fail
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
  // We need to rebase the source commits on top of target.
  // The worktree is on target branch. We cherry-pick the range
  // from merge-base to source onto target using rebase --onto.
  const mergeBaseOut = await git(['merge-base', 'HEAD', sourceSha], { cwd: worktreeDir });
  const base = mergeBaseOut.trim();
  // Replay commits from base..sourceSha onto current HEAD (target)
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

// ─── Refs ───────────────────────────────────────────────────

/**
 *
 * @param repoPath
 * @param ref
 */
export async function resolveRef(repoPath: string, ref: string): Promise<string> {
  const stdout = await git(['rev-parse', ref], { cwd: repoPath });
  return stdout.trim();
}

/**
 *
 * @param repoPath
 * @param tagName
 * @param sha
 * @param message
 */
export async function createTag(
  repoPath: string,
  tagName: string,
  sha: string,
  message?: string,
): Promise<void> {
  if (message) {
    await git(
      [
        '-c',
        'user.name=Axiom',
        '-c',
        'user.email=axiom@local',
        'tag',
        '-a',
        tagName,
        sha,
        '-m',
        message,
      ],
      { cwd: repoPath },
    );
  } else {
    await git(['tag', tagName, sha], { cwd: repoPath });
  }
}

/**
 *
 * @param repoPath
 * @param tagName
 */
export async function deleteTag(repoPath: string, tagName: string): Promise<void> {
  await git(['tag', '-d', tagName], { cwd: repoPath });
}
