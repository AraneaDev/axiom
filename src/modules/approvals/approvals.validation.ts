import { z } from 'zod';

export const createGateSchema = z.object({
  fromColumnId: z.string().min(1),
  toColumnId: z.string().min(1),
  minApprovals: z.number().int().min(1).max(10).default(1),
  allowSelfApproval: z.boolean().default(false),
});

export const updateGateSchema = z.object({
  minApprovals: z.number().int().min(1).max(10).optional(),
  allowSelfApproval: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const createApprovalRequestSchema = z.object({
  approverIds: z.array(z.string().min(1)).min(1).max(10),
});

export const castVoteSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().max(2000).optional(),
});
