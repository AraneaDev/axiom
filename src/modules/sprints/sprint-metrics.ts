/**
 * What done, in progress, to do and committed mean for a sprint. The sprint report and the sprint
 * overview both count through these, so the UI and an agent read the same numbers.
 */
import { classifyColumn } from '../analytics/analytics-helpers';

interface ColumnLike {
  name: string;
  isDefault: boolean;
  isDone: boolean;
}

export type IssueStage = 'done' | 'inProgress' | 'todo';

/**
 * Whether an issue sits in a done column. One outside any column is not done.
 * @param issue - The issue with its column
 * @param issue.column - The column, or null
 */
export function isDoneIssue(issue: { column: { isDone: boolean } | null }): boolean {
  return issue.column?.isDone === true;
}

/**
 * The stage of an issue: done, in progress (a started column, in review included) or to do (the
 * default column, a column of no known kind, or none).
 * @param issue - The issue with its column
 * @param issue.column - The column, or null
 */
export function issueStage(issue: { column: ColumnLike | null }): IssueStage {
  if (!issue.column) return 'todo';
  const kind = classifyColumn(issue.column);
  if (kind === 'done') return 'done';
  return kind === 'inProgress' || kind === 'inReview' ? 'inProgress' : 'todo';
}

/**
 * The story points of an issue, none counting as 0.
 * @param issue - The issue
 * @param issue.storyPoints - Its points
 */
export function pointsOf(issue: { storyPoints: number | null }): number {
  return issue.storyPoints ?? 0;
}

/**
 * The issues the sprint was committed with: added up to the commit moment, minus those removed
 * before it.
 * @param history - The sprint's history entries
 * @param committedAt - When the sprint started
 */
export function committedIssueIds(
  history: ReadonlyArray<{ issueId: string; action: string; timestamp: Date }>,
  committedAt: Date,
): Set<string> {
  const ids = new Set<string>();
  for (const entry of history) {
    if (new Date(entry.timestamp) > committedAt) continue;
    if (entry.action === 'ADDED') ids.add(entry.issueId);
    else if (entry.action === 'REMOVED') ids.delete(entry.issueId);
  }
  return ids;
}
