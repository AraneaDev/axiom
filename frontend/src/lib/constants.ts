export const PRIORITY_COLORS = {
  CRITICAL: 'bg-red-100 text-red-800',
  HIGH: 'bg-orange-100 text-orange-800',
  MEDIUM: 'bg-yellow-100 text-yellow-800',
  LOW: 'bg-green-100 text-green-800',
} as const;

export const ISSUE_TYPE_ICONS = {
  TASK: '☐',
  BUG: '🐛',
  STORY: '📖',
  EPIC: '⚡',
} as const;

export const PRIORITY_LABELS = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
} as const;

export const ISSUE_TYPE_LABELS = {
  TASK: 'Task',
  BUG: 'Bug',
  STORY: 'Story',
  EPIC: 'Epic',
} as const;
