import type { FieldRegistry } from '../ast';

export const issueFieldRegistry: FieldRegistry = {
  type: { column: 'type', type: 'enum', values: ['TASK', 'BUG', 'STORY', 'EPIC'] },
  status: { column: 'column.name', type: 'relation', join: 'column' },
  priority: {
    column: 'priority',
    type: 'enum',
    values: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
    ordinal: true,
  },
  assignee: { column: 'assigneeId', type: 'user', aliasField: 'assignee.username' },
  creator: { column: 'creatorId', type: 'user', aliasField: 'creator.username' },
  label: { column: 'labels.name', type: 'relation', join: 'labels', many: true },
  sprint: { column: 'sprintId', type: 'relation', aliasField: 'sprint.name' },
  project: { column: 'projectId', type: 'relation', aliasField: 'project.prefix' },
  storypoints: { column: 'storyPoints', type: 'number' },
  created: { column: 'createdAt', type: 'date' },
  updated: { column: 'updatedAt', type: 'date' },
  duedate: { column: 'dueDate', type: 'date' },
  number: { column: 'number', type: 'number' },
  title: { column: 'title', type: 'string' },
};

export const PRIORITY_ORDINALS: Record<string, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};
