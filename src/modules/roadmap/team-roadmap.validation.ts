import { z } from 'zod';

export const teamTimelineQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  assigneeId: z.string().optional(),
  type: z.string().optional(),
  projectId: z.string().optional(), // comma-separated project IDs to filter
  search: z.string().max(200).optional(),
});
