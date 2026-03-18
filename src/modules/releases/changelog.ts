export interface CommitEntry {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export interface ChangelogSection {
  type: string;
  label: string;
  commits: CommitEntry[];
}

const TYPE_LABELS: Record<string, string> = {
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance',
  refactor: 'Refactoring',
  docs: 'Documentation',
  test: 'Tests',
  chore: 'Chores',
  other: 'Other Changes',
};

const TYPE_ORDER = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'chore', 'other'];

const CONVENTIONAL_RE = /^(feat|fix|chore|docs|refactor|test|perf)(\([^)]+\))?!?:\s+(.+)/i;

/**
 *
 * @param commits
 */
export function generateChangelog(commits: CommitEntry[]): ChangelogSection[] {
  const groups: Record<string, CommitEntry[]> = {};

  for (const commit of commits) {
    const firstLine = commit.message.split('\n')[0];
    const match = CONVENTIONAL_RE.exec(firstLine);
    const type = match ? match[1].toLowerCase() : 'other';
    if (!groups[type]) groups[type] = [];
    groups[type].push(commit);
  }

  return TYPE_ORDER.filter((t) => groups[t] && groups[t].length > 0).map((t) => ({
    type: t,
    label: TYPE_LABELS[t] ?? t,
    commits: groups[t],
  }));
}
