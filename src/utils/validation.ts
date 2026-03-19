import { z } from 'zod';

import { AppError } from '../middleware/errorHandler';

/**
 * Validate data against a Zod schema, throwing a 400 AppError with formatted messages on failure.
 * @param schema - The Zod schema to validate against
 * @param data - The data to validate
 * @returns The parsed and validated data
 * @throws {AppError} 400 if validation fails
 */
export function validate<T extends z.ZodTypeAny>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new AppError(400, message);
  }
  return result.data;
}

// ─── Auth ───────────────────────────────────────────────────

export const registerSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/),
  displayName: z.string().min(1).max(100),
  password: z.string().min(8).max(128),
  inviteCode: z.string().optional(),
});

export const loginSchema = z.object({
  login: z.string(), // email or username
  password: z.string(),
  twoFactorCode: z.string().length(6).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string(),
});

// ─── Organizations ──────────────────────────────────────────

export const createOrgSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
});

// ─── Teams ──────────────────────────────────────────────────

export const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
});

export const addTeamMemberSchema = z.object({
  userId: z.string(),
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
});

// ─── Projects ───────────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  prefix: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z]+$/),
});

export const updateProjectSchema = createProjectSchema.partial();

// ─── Issues ─────────────────────────────────────────────────

export const createIssueSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().default(''),
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

// ─── Comments ───────────────────────────────────────────────

export const createCommentSchema = z.object({
  body: z.string().min(1),
});

// ─── Wiki ───────────────────────────────────────────────────

export const createWikiSpaceSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
});

export const createPageSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/),
  body: z.string().default(''),
  parentId: z.string().optional(),
  isDraft: z.boolean().default(false),
});

export const updatePageSchema = createPageSchema.partial();

// ─── Wiki Templates ─────────────────────────────────────────

export const createPageTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  body: z.string().min(0).default(''),
  description: z.string().max(500).optional(),
});

// ─── Wiki Page Comments ─────────────────────────────────────

export const createPageCommentSchema = z.object({
  body: z.string().min(1),
  anchorText: z.string().optional(),
});

// ─── Wiki Page Labels ───────────────────────────────────────

export const addPageLabelSchema = z.object({
  label: z.string().min(1).max(100),
});

// ─── Wiki Page Move / Copy ──────────────────────────────────

export const movePageSchema = z.object({
  targetSpaceId: z.string().optional(),
  targetParentId: z.string().nullable().optional(),
});

export const copyPageSchema = z.object({
  targetSpaceId: z.string().optional(),
  newSlug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});

// ─── API Tokens ─────────────────────────────────────────────

export const createApiTokenSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).min(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

// ─── SSH Keys ───────────────────────────────────────────────

export const addSshKeySchema = z.object({
  title: z.string().min(1).max(100),
  publicKey: z.string().min(1),
});

// ─── Search ─────────────────────────────────────────────────

export const searchSchema = z.object({
  q: z.string().min(1),
  type: z.enum(['issues', 'wiki', 'repos', 'code', 'all']).default('all'),
  teamId: z.string().optional(),
  projectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const codeSearchSchema = z.object({
  q: z.string().min(1),
  repoIds: z.string().optional(), // comma-separated repo IDs
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export const savedSearchSchema = z.object({
  name: z.string().min(1).max(100),
  query: z.object({
    q: z.string(),
    type: z.string().optional(),
    filters: z.record(z.string()).optional(),
  }),
});

// ─── Repositories ──────────────────────────────────────────

export const createRepoSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
  visibility: z.enum(['PRIVATE', 'INTERNAL', 'PUBLIC']).default('PRIVATE'),
  defaultBranch: z.string().max(100).optional(),
});

export const updateRepoSchema = createRepoSchema.partial();

export const forkRepoSchema = z.object({
  targetTeamId: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
});

export const createBranchSchema = z.object({
  name: z.string().min(1).max(200),
  startPoint: z.string().default('HEAD'),
});

export const updateRepoSettingsSchema = z.object({
  defaultMergeStrategy: z.string().optional(),
  codeOwnersEnabled: z.boolean().optional(),
});

// ─── Pull Requests ─────────────────────────────────────────

export const createPRSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().default(''),
  sourceBranch: z.string().min(1),
  targetBranch: z.string().min(1),
});

export const updatePRSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().optional(),
});

export const mergePRSchema = z.object({
  strategy: z.enum(['merge', 'squash', 'rebase']).default('merge'),
});

export const submitReviewSchema = z.object({
  status: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED']),
  body: z.string().optional(),
  comments: z
    .array(
      z.object({
        path: z.string(),
        line: z.number().int(),
        body: z.string().min(1),
      }),
    )
    .optional(),
});

export const addPRCommentSchema = z.object({
  body: z.string().min(1),
  filePath: z.string().optional(),
  line: z.number().int().optional(),
  replyToId: z.string().optional(),
});

export const applySuggestionSchema = z.object({
  commentId: z.string().min(1),
});

export const batchApplySuggestionsSchema = z.object({
  commentIds: z.array(z.string().min(1)).min(1),
});

// ─── Labels ────────────────────────────────────────────────

export const createLabelSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().min(1).max(30),
  description: z.string().max(500).optional(),
});

export const updateLabelSchema = createLabelSchema.partial();

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

// ─── Pipelines ─────────────────────────────────────────────

export const createPipelineSchema = z.object({
  name: z.string().min(1).max(100),
  yamlContent: z.string().min(1),
});

export const updatePipelineSchema = createPipelineSchema.partial();

export const triggerRunSchema = z.object({
  ref: z.string().default('HEAD'),
});

// ─── Releases ──────────────────────────────────────────────

export const createReleaseSchema = z.object({
  tagName: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  body: z.string().optional(),
  isDraft: z.boolean().default(false),
  isPrerelease: z.boolean().default(false),
  targetBranch: z.string().min(1),
  commitSha: z.string().optional(),
});

export const updateReleaseSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().optional(),
  isDraft: z.boolean().optional(),
  isPrerelease: z.boolean().optional(),
});

// ─── Deployments ───────────────────────────────────────────

export const createEnvironmentSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url().optional(),
  protectionRules: z.record(z.unknown()).optional(),
});

export const updateEnvironmentSchema = createEnvironmentSchema.partial();

export const createDeploymentSchema = z.object({
  commitSha: z.string().min(1),
  pipelineRunId: z.string().optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILURE']).optional(),
});
