import { z } from 'zod';

import { listPosition } from '../../utils/validation';

export const createBucketSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().max(50).optional(),
  position: listPosition.optional(),
});

export const updateBucketSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().max(50).nullable().optional(),
  position: listPosition.optional(),
});

export const reorderBucketsSchema = z.object({
  bucketIds: z.array(z.string()).min(1),
});

export const setIssueBucketSchema = z.object({
  bucketId: z.string().min(1).nullable(),
});

const roadmapDate = z.iso.date().nullable().optional();

export const setIssueDatesSchema = z.object({
  startDate: roadmapDate,
  dueDate: roadmapDate,
});

export const timelineQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  assigneeId: z.string().optional(),
  labelId: z.string().optional(),
  type: z.string().optional(),
  milestoneId: z.string().optional(),
  sprintId: z.string().optional(),
  search: z.string().max(200).optional(),
});

export const bucketsViewQuerySchema = z.object({
  assigneeId: z.string().optional(),
  labelId: z.string().optional(),
  type: z.string().optional(),
  milestoneId: z.string().optional(),
  sprintId: z.string().optional(),
  search: z.string().max(200).optional(),
});
