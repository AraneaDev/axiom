import type { Filters } from './BoardFilters';

import { PRIORITY_LABELS } from '@/lib/constants';
import type { Issue } from '@/lib/types';

export const PRIORITY_CARD_COLORS: Record<string, string> = {
  CRITICAL: 'var(--card-color-critical)',
  HIGH: 'var(--card-color-high)',
  MEDIUM: 'var(--card-color-medium)',
  LOW: 'var(--card-color-low)',
};

export const TYPE_CARD_COLORS: Record<string, string> = {
  BUG: 'var(--card-color-bug)',
  STORY: 'var(--card-color-story)',
  TASK: 'var(--card-color-task)',
  EPIC: 'var(--card-color-epic)',
};

export const PRIORITY_LEGEND: { key: string; label: string; color: string }[] = [
  { key: 'CRITICAL', label: 'Critical', color: 'var(--card-color-critical)' },
  { key: 'HIGH', label: 'High', color: 'var(--card-color-high)' },
  { key: 'MEDIUM', label: 'Medium', color: 'var(--card-color-medium)' },
  { key: 'LOW', label: 'Low', color: 'var(--card-color-low)' },
];

export const TYPE_LEGEND: { key: string; label: string; color: string }[] = [
  { key: 'BUG', label: 'Bug', color: 'var(--card-color-bug)' },
  { key: 'STORY', label: 'Story', color: 'var(--card-color-story)' },
  { key: 'TASK', label: 'Task', color: 'var(--card-color-task)' },
  { key: 'EPIC', label: 'Epic', color: 'var(--card-color-epic)' },
];

export interface SwimLane {
  key: string;
  label: string;
  issues: Issue[];
}

/**
 *
 * @param issues
 * @param filters
 */
export function applyFilters(issues: Issue[], filters: Filters): Issue[] {
  let result = issues;
  if (filters.assignee.length > 0)
    result = result.filter((i) => i.assignee && filters.assignee.includes(i.assignee.id));
  if (filters.priority.length > 0)
    result = result.filter((i) => filters.priority.includes(i.priority));
  if (filters.label.length > 0)
    result = result.filter((i) => i.labels?.some((l) => filters.label.includes(l.id)));
  if (filters.type.length > 0) result = result.filter((i) => filters.type.includes(i.type));
  return result;
}

/**
 *
 * @param issues
 * @param groupBy
 */
export function groupIssues(issues: Issue[], groupBy: string): SwimLane[] {
  if (groupBy === 'none') return [{ key: '__all', label: '', issues }];

  const groups = new Map<string, { label: string; issues: Issue[] }>();

  for (const issue of issues) {
    let key: string;
    let label: string;

    switch (groupBy) {
      case 'assignee':
        key = issue.assignee?.id ?? '__unassigned';
        label = issue.assignee?.displayName ?? 'Unassigned';
        break;
      case 'priority':
        key = issue.priority;
        label = PRIORITY_LABELS[issue.priority as keyof typeof PRIORITY_LABELS] ?? issue.priority;
        break;
      case 'epic':
        key = issue.parentId ?? '__no-epic';
        label = issue.parent?.title ?? 'No Epic';
        break;
      default:
        key = '__all';
        label = '';
    }

    if (!groups.has(key)) groups.set(key, { label, issues: [] });
    groups.get(key)!.issues.push(issue);
  }

  return Array.from(groups.entries()).map(([key, val]) => ({
    key,
    label: val.label,
    issues: val.issues,
  }));
}
