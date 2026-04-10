import { z } from 'zod';

export const listSubmissionsSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SPAM']).optional(),
  formId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const reviewSubmissionSchema = z.object({
  reviewNote: z.string().max(2000).optional(),
});

export const approveSubmissionSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(100000).optional(),
  type: z.enum(['TASK', 'BUG', 'STORY', 'EPIC']).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  assigneeId: z.string().optional(),
  labels: z.array(z.string()).optional(),
});
