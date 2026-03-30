import { execFile } from 'child_process';
import { promisify } from 'util';

import { getRepoDiskPath } from '../../utils/repo-disk';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;

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

// ─── Extension to language mapping ──────────────────────────

const EXT_LANG_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.css': 'CSS',
  '.scss': 'CSS',
  '.less': 'CSS',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.mdx': 'Markdown',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.hpp': 'C++',
  '.cs': 'C#',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.php': 'PHP',
  '.r': 'R',
  '.R': 'R',
  '.lua': 'Lua',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.erl': 'Erlang',
  '.hs': 'Haskell',
  '.scala': 'Scala',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.xml': 'XML',
  '.toml': 'TOML',
  '.ini': 'INI',
  '.cfg': 'INI',
  '.dockerfile': 'Docker',
  '.prisma': 'Prisma',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  '.proto': 'Protobuf',
  '.tf': 'Terraform',
  '.hcl': 'HCL',
};

function getExtension(filename: string): string {
  const lower = filename.toLowerCase();
  const lastDot = lower.lastIndexOf('.');
  if (lastDot === -1) return '';
  return lower.slice(lastDot);
}

function getLanguage(filename: string): string | null {
  const base = filename.toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'Docker';
  if (base === 'makefile' || base === 'gnumakefile') return 'Makefile';
  const ext = getExtension(filename);
  return EXT_LANG_MAP[ext] ?? null;
}

// ─── Commit frequency ───────────────────────────────────────

export interface CommitFrequencyPoint {
  date: string;
  count: number;
}

/**
 * Returns array of { date, count } for commits per day over last N days.
 * @param repoId
 * @param days
 */
export async function getCommitFrequency(
  repoId: string,
  days: number = 90,
): Promise<CommitFrequencyPoint[]> {
  const diskPath = await getRepoDiskPath(repoId);
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  let stdout: string;
  try {
    stdout = await git(['log', '--all', `--since=${sinceStr}`, '--format=%ai'], { cwd: diskPath });
  } catch {
    return [];
  }

  if (!stdout.trim()) return [];

  const dateCounts: Record<string, number> = {};
  for (const line of stdout.trim().split('\n')) {
    const date = line.split(' ')[0];
    dateCounts[date] = (dateCounts[date] || 0) + 1;
  }

  // Fill in missing dates with 0
  const result: CommitFrequencyPoint[] = [];
  const current = new Date(sinceStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  while (current <= today) {
    const dateStr = current.toISOString().split('T')[0];
    result.push({ date: dateStr, count: dateCounts[dateStr] || 0 });
    current.setDate(current.getDate() + 1);
  }

  return result;
}

// ─── Contributors ────────────────────────────────────────────

export interface ContributorInfo {
  name: string;
  email: string;
  commits: number;
  lastCommitDate: string;
}

/**
 * Returns array of contributors with commit counts.
 * @param repoId
 */
export async function getContributors(repoId: string): Promise<ContributorInfo[]> {
  const diskPath = await getRepoDiskPath(repoId);

  let shortlogOutput: string;
  try {
    shortlogOutput = await git(['shortlog', '-sne', '--all'], { cwd: diskPath });
  } catch {
    return [];
  }

  if (!shortlogOutput.trim()) return [];

  const contributors: ContributorInfo[] = [];
  for (const line of shortlogOutput.trim().split('\n')) {
    const match = line.trim().match(/^(\d+)\t(.+?)\s+<(.+?)>$/);
    if (!match) continue;
    const commits = parseInt(match[1], 10);
    const name = match[2];
    const email = match[3];

    // Get last commit date for this contributor
    let lastCommitDate = '';
    try {
      const dateOutput = await git(['log', '--all', '--author=' + email, '-1', '--format=%aI'], {
        cwd: diskPath,
      });
      lastCommitDate = dateOutput.trim();
    } catch {
      // skip
    }

    contributors.push({ name, email, commits, lastCommitDate });
  }

  return contributors.sort((a, b) => b.commits - a.commits);
}

// ─── Language breakdown ──────────────────────────────────────

export interface LanguageBreakdown {
  language: string;
  bytes: number;
  percentage: number;
}

/**
 * Returns language breakdown by file size.
 * @param repoId
 * @param ref
 */
export async function getLanguageBreakdown(
  repoId: string,
  ref: string = 'HEAD',
): Promise<LanguageBreakdown[]> {
  const diskPath = await getRepoDiskPath(repoId);

  let stdout: string;
  try {
    stdout = await git(['ls-tree', '-r', '-l', ref], { cwd: diskPath });
  } catch {
    return [];
  }

  if (!stdout.trim()) return [];

  const langBytes: Record<string, number> = {};
  let totalBytes = 0;

  for (const line of stdout.trim().split('\n')) {
    // Format: mode SP type SP sha SP size TAB path
    const match = line.match(/^\d+\s+blob\s+[a-f0-9]+\s+(\d+)\t(.+)$/);
    if (!match) continue;
    const size = parseInt(match[1], 10);
    const filePath = match[2];
    const fileName = filePath.split('/').pop() || filePath;
    const lang = getLanguage(fileName);
    if (!lang) continue;
    langBytes[lang] = (langBytes[lang] || 0) + size;
    totalBytes += size;
  }

  if (totalBytes === 0) return [];

  return Object.entries(langBytes)
    .map(([language, bytes]) => ({
      language,
      bytes,
      percentage: Math.round((bytes / totalBytes) * 10000) / 100,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

// ─── Code frequency ──────────────────────────────────────────

export interface CodeFrequencyPoint {
  week: string;
  additions: number;
  deletions: number;
}

/**
 * Returns weekly additions/deletions.
 * @param repoId
 * @param weeks
 */
export async function getCodeFrequency(
  repoId: string,
  weeks: number = 52,
): Promise<CodeFrequencyPoint[]> {
  const diskPath = await getRepoDiskPath(repoId);
  const since = new Date();
  since.setDate(since.getDate() - weeks * 7);
  const sinceStr = since.toISOString().split('T')[0];

  let stdout: string;
  try {
    stdout = await git(['log', '--all', `--since=${sinceStr}`, '--numstat', '--format=%aI'], {
      cwd: diskPath,
    });
  } catch {
    return [];
  }

  if (!stdout.trim()) return [];

  const weeklyData: Record<string, { additions: number; deletions: number }> = {};
  let currentDate = '';

  for (const line of stdout.trim().split('\n')) {
    if (!line.trim()) continue;

    // Date lines look like ISO dates
    if (line.match(/^\d{4}-\d{2}-\d{2}T/)) {
      currentDate = line.trim();
      continue;
    }

    // numstat lines: additions TAB deletions TAB file
    const parts = line.split('\t');
    if (parts.length >= 3 && currentDate) {
      const add = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
      const del = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
      if (isNaN(add) || isNaN(del)) continue;

      // Get the Monday of the week for this date
      const d = new Date(currentDate);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      const weekKey = d.toISOString().split('T')[0];

      if (!weeklyData[weekKey]) weeklyData[weekKey] = { additions: 0, deletions: 0 };
      weeklyData[weekKey].additions += add;
      weeklyData[weekKey].deletions += del;
    }
  }

  return Object.entries(weeklyData)
    .map(([week, data]) => ({ week, ...data }))
    .sort((a, b) => a.week.localeCompare(b.week));
}
