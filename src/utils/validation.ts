import { z } from 'zod';

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
  body: z.string().default(''),
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
