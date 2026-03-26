import { z } from 'zod';

import { AppError } from '../../middleware/errorHandler';

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

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
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

// ─── Comments ───────────────────────────────────────────────

export const createCommentSchema = z.object({
  body: z.string().min(1),
});

// ─── Labels ────────────────────────────────────────────────

export const createLabelSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().min(1).max(30),
  description: z.string().max(500).optional(),
});

export const updateLabelSchema = createLabelSchema.partial();

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

// ─── Admin ──────────────────────────────────────────────────

export const adminUpdateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST']).optional(),
  email: z.string().email().optional(),
});

export const adminResetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(128),
});

// --- Workflows ---

export const createWorkflowRuleSchema = z.object({
  fromColumnId: z.string().min(1),
  toColumnId: z.string().min(1),
});

export const updateWorkflowRuleSchema = createWorkflowRuleSchema.partial();

// --- Invitations ---

export const createInvitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST']),
  teamId: z.string().optional(),
});

// --- Organizations (additional) ---

export const updateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

export const addOrgMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST']).default('MEMBER'),
});

export const createInviteLinkSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST']).default('MEMBER'),
  maxUses: z.number().int().min(1).max(1000).default(25),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

// --- Issue Templates ---

export const createIssueTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['TASK', 'BUG', 'STORY', 'EPIC']),
  title: z.string().min(1).max(500),
  body: z.string().default(''),
  labels: z.array(z.string()).optional(),
  assigneeId: z.string().optional(),
});

export const updateIssueTemplateSchema = createIssueTemplateSchema.partial();
