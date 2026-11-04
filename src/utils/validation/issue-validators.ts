import { z } from 'zod';

import { MAX_DB_INT } from './common-validators';

const ISSUE_TYPES = ['TASK', 'BUG', 'STORY', 'EPIC'] as const;
const ISSUE_PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

/**
 * A filter on an enum column: either case, the empty value of a bare `?type=` meaning no filter.
 * The search filters read `type:bug` the same way.
 * @param values - The column's values
 */
function enumFilter(values: readonly string[]) {
  const accepted = [...values, ...values.map((value) => value.toLowerCase()), ''];
  return z
    .enum(accepted as [string, ...string[]])
    .transform((value) => value.toUpperCase())
    .optional();
}

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

// partial() keeps the defaults of createIssueSchema, so a title-only update would reset the
// body, type and priority. These three are declared again without them.
export const updateIssueSchema = createIssueSchema.partial().extend({
  body: z.string().max(100_000).optional(),
  type: z.enum(['TASK', 'BUG', 'STORY', 'EPIC']).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  columnId: z.string().optional(),
  position: z.number().int().max(MAX_DB_INT).optional(),
  storyPoints: z.number().int().min(0).max(100).nullable().optional(),
  sprintId: z.string().nullable().optional(),
  timeEstimate: z.number().int().min(0).max(MAX_DB_INT).nullable().optional(),
  timeSpent: z.number().int().min(0).max(MAX_DB_INT).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  roadmapBucketId: z.string().nullable().optional(),
});

// ─── Worklogs ───────────────────────────────────────────────

export const logWorkSchema = z.object({
  minutes: z.number().int().min(1).max(MAX_DB_INT),
  description: z.string().max(500).optional(),
});

// ─── Web links ───────────────────────────────────────────────

export const issueWebLinkSchema = z.object({
  url: z
    .string()
    .max(2000)
    .url()
    .refine((value) => /^https?:\/\//i.test(value), 'must be an http or https URL'),
  title: z.string().trim().min(1).max(200).optional(),
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
  type: enumFilter(ISSUE_TYPES),
  priority: enumFilter(ISSUE_PRIORITIES),
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
