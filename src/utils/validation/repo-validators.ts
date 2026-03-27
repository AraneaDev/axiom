import { z } from 'zod';

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

export const updateFileSchema = z.object({
  content: z.string(),
  message: z.string().min(1).max(500),
  branch: z.string().min(1),
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
  protectionRules: z.record(z.string(), z.unknown()).optional(),
});

export const updateEnvironmentSchema = createEnvironmentSchema.partial();

export const createDeploymentSchema = z.object({
  commitSha: z.string().min(1),
  pipelineRunId: z.string().optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILURE']).optional(),
});
