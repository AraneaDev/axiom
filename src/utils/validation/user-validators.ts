import { z } from 'zod';

import { TOKEN_SCOPES } from '../../middleware/token-scopes';

// ─── API Tokens ─────────────────────────────────────────────

export const createApiTokenSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
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
  body: z.string().max(500_000).default(''),
  parentId: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined),
  isDraft: z.boolean().default(false),
});

export const updatePageSchema = createPageSchema
  .extend({
    changeDescription: z.string().max(500).optional(),
  })
  .partial()
  // partial() keeps the defaults of body and isDraft, which would blank a page on a title-only
  // update or turn a draft into a published page
  .extend({
    body: z.string().max(500_000).optional(),
    isDraft: z.boolean().optional(),
    // null moves the page to the top level, and leaving the field out keeps the parent. The
    // create schema turns null into undefined, which an update must not do
    parentId: z.string().nullable().optional(),
  });

export const flushPageSessionSchema = z.object({
  changeDescription: z.string().max(500).optional(),
});

export const restoreVersionSchema = z.object({
  version: z.number().int().min(1),
});

export const applyMergeSchema = z.object({
  externalVersionId: z.string().min(1),
  markdown: z.string().max(500_000),
  /** The live session text the merge was computed against; required so late edits are rebased */
  ours: z.string().max(500_000),
});

// ─── Wiki Templates ─────────────────────────────────────────

export const createPageTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  body: z.string().min(0).max(500_000).default(''),
  description: z.string().max(500).optional(),
});

// ─── Wiki Page Comments ─────────────────────────────────────

export const createPageCommentSchema = z.object({
  body: z.string().min(1).max(50_000),
  anchorText: z.string().max(1000).optional(),
});

// ─── Wiki Page Labels ───────────────────────────────────────

export const addPageLabelSchema = z.object({
  label: z.string().min(1).max(100),
});

// ─── Wiki Page Restrictions ─────────────────────────────────

export const setRestrictionsSchema = z.object({
  type: z.enum(['VIEW', 'EDIT']),
  userIds: z.array(z.string()).min(0),
});

// ─── Wiki Page Move / Copy ──────────────────────────────────

export const movePageSchema = z.object({
  targetSpaceId: z.string().optional(),
  targetParentId: z.string().nullable().optional(),
});

export const reorderPageSchema = z.object({
  parentId: z.string().nullable(),
  position: z.number().int().min(0),
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
