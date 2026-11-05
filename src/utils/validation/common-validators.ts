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
    const message = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new AppError(400, message);
  }
  return result.data;
}

// ─── Shared Validators ─────────────────────────────────────

/** The largest value of an integer column: anything past it is a failed query, not a miss. */
export const MAX_DB_INT = 2147483647;
export const MIN_DB_INT = -2147483648;

/** A whole number that fits an integer column. */
export const dbInt = z.number().int().min(MIN_DB_INT).max(MAX_DB_INT);

/**
 * A position in an ordered list (columns, buckets, fields). Capped well below the column, because a
 * new item lands one past the last, and a last one at the top would overflow the next.
 */
export const listPosition = z.number().int().min(0).max(100_000);

/**
 * A whole number from a number or from digits only. `z.coerce.number()` also takes `''`, `' 5 '`
 * and `0x10`, and `parseInt` reads `5abc` as 5, so ids that come from a path or a body use this.
 */
export const strictInt = z.union([
  z.number().int().min(0).max(MAX_DB_INT),
  z
    .string()
    .regex(/^\d+$/, 'must be a whole number')
    .transform((value) => parseInt(value, 10))
    .pipe(z.number().max(MAX_DB_INT)),
]);

/** Reusable slug: 2-50 lowercase alphanumeric + hyphens */
export const slugValidator = z
  .string()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9-]+$/);

/**
 * What a new org may not be called: /:org is the last route the app tries, so an org with the name
 * of a top-level route would never reach its own page. org-slugs.test.ts ties this to the router.
 * Orgs that already have such a slug stay as they are.
 */
export const RESERVED_ORG_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'approvals',
  'assets',
  'dashboard',
  'dashboards',
  'f',
  'forgot-password',
  'login',
  'notifications',
  'orgs',
  'register',
  'reset-password',
  'search',
  'settings',
  'setup-2fa',
  'ws',
]);

/** Team-level role enum */
export const teamRoleValidator = z.enum(['ADMIN', 'MEMBER', 'VIEWER']);

/** Org-level role enum (superset of team roles) */
export const orgRoleValidator = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST']);

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
  slug: slugValidator.refine((slug) => !RESERVED_ORG_SLUGS.has(slug), {
    message: 'This slug is reserved by the app, choose another',
  }),
  description: z.string().max(500).optional(),
});

// ─── Teams ──────────────────────────────────────────────────

export const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  slug: slugValidator,
  description: z.string().max(500).optional(),
});

export const addTeamMemberSchema = z.object({
  userId: z.string(),
  role: teamRoleValidator.default('MEMBER'),
});

// ─── Projects ───────────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  slug: slugValidator,
  description: z.string().max(2000).optional(),
  prefix: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z]+$/),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  cardColorBy: z.enum(['priority', 'type']).nullable().optional(),
});

// ─── Comments ───────────────────────────────────────────────

export const createCommentSchema = z.object({
  body: z.string().min(1).max(50_000),
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
  q: z
    .string()
    .min(1)
    .max(1000)
    .refine((value) => !value.includes('\u0000'), 'must not contain a NUL character'),
  type: z.enum(['issues', 'wiki', 'all']).default('all'),
  teamId: z.string().optional(),
  projectId: z.string().optional(),
  spaceId: z.string().optional(),
  label: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(MAX_DB_INT).default(0),
});

export const savedSearchSchema = z.object({
  name: z.string().min(1).max(100),
  query: z.object({
    q: z.string(),
    type: z.string().optional(),
    filters: z.record(z.string(), z.string()).optional(),
  }),
});

// ─── Admin ──────────────────────────────────────────────────

export const adminListUsersQuerySchema = z.object({
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(MAX_DB_INT).optional(),
});

export const adminUpdateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  role: orgRoleValidator.optional(),
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
  role: orgRoleValidator,
  teamId: z.string().optional(),
});

// --- Organizations (additional) ---

export const updateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

export const addOrgMemberSchema = z.object({
  userId: z.string().min(1),
  role: orgRoleValidator.default('MEMBER'),
});

export const createInviteLinkSchema = z.object({
  role: orgRoleValidator.default('MEMBER'),
  maxUses: z.number().int().min(1).max(1000).default(25),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

// --- Issue Templates ---

export const createIssueTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['TASK', 'BUG', 'STORY', 'EPIC']),
  title: z.string().min(1).max(500),
  body: z.string().max(100_000).default(''),
  labels: z.array(z.string()).optional(),
  assigneeId: z.string().optional(),
});

// partial() keeps the default of body, which would blank it on an update that leaves it out
export const updateIssueTemplateSchema = createIssueTemplateSchema.partial().extend({
  body: z.string().max(100_000).optional(),
});

// --- Milestones ---

export const createMilestoneSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueDate: z.string().optional(),
});

export const updateMilestoneSchema = createMilestoneSchema.partial().extend({
  status: z.enum(['OPEN', 'CLOSED']).optional(),
});

const digits = z
  .string()
  .regex(/^\d*$/, 'must be a whole number, 0 or more')
  .refine((value) => !/^\d+$/.test(value) || Number(value) <= MAX_DB_INT, 'is too large');

/**
 * A paging or count value in a query: digits, a repeated value, or a whole number from an MCP
 * caller. Handlers narrow it with `firstQueryText`.
 */
export const queryCount = z
  .union([digits, z.array(digits), z.number().int().min(0).max(MAX_DB_INT)])
  .optional();

/**
 * The text of a query value: a number as its digits, a repeated value as its first.
 * So 0 and "0" read alike.
 * @param value - A parsed queryCount
 */
export function firstQueryText(value: string | string[] | number | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return typeof value === 'number' ? String(value) : value;
}
