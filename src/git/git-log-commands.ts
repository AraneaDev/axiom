import { git, validateRef, validateSha } from './git-core';

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
  validateRef(ref);
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
  validateSha(sha);
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
  validateRef(ref);
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
  validateRef(ref);
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
  validateRef(ref);
  return git(['show', `${ref}:${filePath}`], { cwd: repoPath });
}

/**
 *
 * @param repoPath
 * @param ref
 * @param filePath
 */
export async function blobSize(repoPath: string, ref: string, filePath: string): Promise<number> {
  validateRef(ref);
  const stdout = await git(['cat-file', '-s', `${ref}:${filePath}`], { cwd: repoPath });
  return parseInt(stdout.trim(), 10);
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
  validateRef(ref);
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

// ─── Refs ───────────────────────────────────────────────────

/**
 *
 * @param repoPath
 * @param ref
 */
export async function resolveRef(repoPath: string, ref: string): Promise<string> {
  validateRef(ref);
  const stdout = await git(['rev-parse', ref], { cwd: repoPath });
  return stdout.trim();
}
