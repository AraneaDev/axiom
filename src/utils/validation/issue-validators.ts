import { z } from 'zod';

// ─── Issues ─────────────────────────────────────────────────

export const createIssueSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(100_000).default(''),
  type: z.enum(['TASK', 'BUG', 'STORY', 'EPIC']).default('TASK'),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  assigneeId: z.string().optional(),
  labels: z.array(z.string()).optional(),
  dueDate: z.string().datetime().optional(),
});

export const updateIssueSchema = createIssueSchema.partial().extend({
  columnId: z.string().optional(),
  position: z.number().int().optional(),
  storyPoints: z.number().int().min(0).max(100).nullable().optional(),
  sprintId: z.string().nullable().optional(),
  timeEstimate: z.number().int().min(0).nullable().optional(),
  timeSpent: z.number().int().min(0).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  roadmapBucketId: z.string().nullable().optional(),
});

// ─── Worklogs ───────────────────────────────────────────────

export const logWorkSchema = z.object({
  minutes: z.number().int().min(1),
  description: z.string().max(500).optional(),
});

// ─── Bulk Operations ────────────────────────────────────────

export const bulkUpdateIssuesSchema = z.object({
  issueIds: z.array(z.string()).min(1),
  updates: z.object({
    status: z.string().optional(),
    assigneeId: z.string().nullable().optional(),
    priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
    sprintId: z.string().nullable().optional(),
    labels: z.array(z.string()).optional(),
  }),
});

// ─── Issue List Query ──────────────────────────────────────

export const issueListQuerySchema = z.object({
  q: z.string().max(1000).optional(),
  type: z.string().optional(),
  priority: z.string().optional(),
  assigneeId: z.string().optional(),
  columnId: z.string().optional(),
  sprintId: z.string().optional(),
  label: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ─── Sprints ───────────────────────────────────────────────

export const createSprintSchema = z.object({
  name: z.string().min(1).max(100),
  goal: z.string().max(500).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

export const updateSprintSchema = createSprintSchema.partial();

export const completeSprintSchema = z.object({
  moveToSprintId: z.string().optional(),
});

export const addSprintIssuesSchema = z.object({
  issueIds: z.array(z.string().min(1)).min(1),
});
