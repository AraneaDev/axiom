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
  assignee: { column: 'assigneeId', type: 'user', aliasField: 'assignee.username', nullable: true },
  creator: { column: 'creatorId', type: 'user', aliasField: 'creator.username' },
  label: { column: 'labels.name', type: 'relation', join: 'labels', many: true },
  sprint: { column: 'sprintId', type: 'relation', aliasField: 'sprint.name', nullable: true },
  project: { column: 'projectId', type: 'relation', aliasField: 'project.prefix' },
  storypoints: { column: 'storyPoints', type: 'number', nullable: true },
  created: { column: 'createdAt', type: 'date' },
  updated: { column: 'updatedAt', type: 'date' },
  duedate: { column: 'dueDate', type: 'date', nullable: true },
  number: { column: 'number', type: 'number' },
  title: { column: 'title', type: 'string' },
  blocked: { column: 'links', type: 'derived' },
  blocks: { column: 'links', type: 'derived' },
  linked: { column: 'links', type: 'derived' },
  text: { column: 'title,body', type: 'derived' },
  done: { column: 'column.isDone', type: 'derived' },
  sprintstate: {
    column: 'sprint.status',
    type: 'derived',
    values: ['PLANNING', 'ACTIVE', 'COMPLETED'],
  },
};

export const PRIORITY_ORDINALS: Record<string, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};
