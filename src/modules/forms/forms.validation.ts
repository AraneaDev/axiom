import { z } from 'zod';

// ─── Form CRUD ──────────────────────────────────────────────

const formFields = {
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes only'),
  description: z.string().max(2000).optional(),
  authMode: z.enum(['PUBLIC', 'TOKEN_GATED']),
  /** Refused by the service: access codes are generated (see form-secret.ts) */
  sharedSecret: z.string().max(500).optional(),
  spamProtection: z.enum(['NONE', 'CAPTCHA', 'RATE_LIMIT']),
  rateLimitPerHour: z.number().int().min(1).max(10000).optional(),
  successMessage: z.string().max(2000).optional(),
  redirectUrl: z.string().url().max(2000).optional(),
};

export const createFormSchema = z.object({
  ...formFields,
  authMode: formFields.authMode.default('PUBLIC'),
  spamProtection: formFields.spamProtection.default('NONE'),
});

/**
 * Built from the fields without their defaults: a partial update must not reset authMode
 * to PUBLIC (un-gating a gated form) or spamProtection to NONE when they are left out.
 */
export const updateFormSchema = z.object(formFields).partial().extend({
  /** Generate a new access code for a gated form (returned once) */
  regenerateSecret: z.boolean().optional(),
});

// ─── Pages ──────────────────────────────────────────────────

export const createPageSchema = z.object({
  title: z.string().min(1).max(200),
  position: z.number().int().min(0).optional(),
  conditionFieldId: z.string().optional(),
  conditionOperator: z.enum(['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'GT', 'LT']).optional(),
  conditionValue: z.string().max(500).optional(),
});

export const updatePageSchema = createPageSchema.partial();

export const reorderPagesSchema = z.object({
  pageIds: z.array(z.string()).min(1),
});

// ─── Fields ─────────────────────────────────────────────────

export const createFieldSchema = z.object({
  type: z.enum([
    'TEXT',
    'TEXTAREA',
    'SELECT',
    'MULTISELECT',
    'CHECKBOX',
    'RADIO',
    'DATE',
    'FILE',
    'HEADING',
    'DESCRIPTION',
  ]),
  label: z.string().min(1).max(200),
  placeholder: z.string().max(200).optional(),
  helpText: z.string().max(500).optional(),
  required: z.boolean().default(false),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
      }),
    )
    .optional(),
  issueFieldMapping: z.string().max(200).optional(),
  validationRules: z
    .object({
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().min(0).optional(),
      pattern: z.string().optional(),
    })
    .optional(),
  position: z.number().int().min(0).optional(),
});

// Without the create default: a patch that leaves out `required` must leave it alone
export const updateFieldSchema = createFieldSchema
  .partial()
  .extend({ required: z.boolean().optional() });

export const reorderFieldsSchema = z.object({
  fieldIds: z.array(z.string()).min(1),
});

// ─── Submissions ─────────────────────────────────────────────

export const submitFormSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  submitterEmail: z.string().email().max(254).optional(),
  submitterName: z.string().max(200).optional(),
  captchaToken: z.string().optional(),
  honeypot: z.string().optional(),
  /** The shared secret of a token-gated form */
  secret: z.string().max(500).optional(),
});

export const verifyFormSchema = z.object({
  secret: z.string().optional(),
  captchaToken: z.string().optional(),
});
