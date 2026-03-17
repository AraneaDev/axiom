export const PRIORITY_COLORS = {
  CRITICAL: 'bg-danger-light text-danger',
  HIGH: 'bg-warning-light text-warning',
  MEDIUM: 'bg-primary-light text-primary',
  LOW: 'bg-success-light text-success',
} as const;

// Issue type icon names — render with Lucide components in UI
export const ISSUE_TYPE_ICON_NAMES = {
  TASK: 'CheckSquare',
  BUG: 'Bug',
  STORY: 'BookOpen',
  EPIC: 'Zap',
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
