import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate } from '../../utils/validation';

import * as roadmapService from './roadmap.service';
import {
  createBucketSchema,
  updateBucketSchema,
  reorderBucketsSchema,
  timelineQuerySchema,
  bucketsViewQuerySchema,
} from './roadmap.validation';

// ─── Bucket CRUD ─────────────────────────────────────────────────────────────

export const listBuckets = asyncHandler(async (req: Request, res: Response) => {
  const buckets = await roadmapService.listBuckets(param(req, 'projectId'));
  res.json(buckets);
});

export const createBucket = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createBucketSchema, req.body);
  const bucket = await roadmapService.createBucket(param(req, 'projectId'), data);
  res.status(201).json(bucket);
});

export const updateBucket = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateBucketSchema, req.body);
  const bucket = await roadmapService.updateBucket(param(req, 'projectId'), param(req, 'id'), data);
  res.json(bucket);
});

export const deleteBucket = asyncHandler(async (req: Request, res: Response) => {
  await roadmapService.deleteBucket(param(req, 'projectId'), param(req, 'id'));
  res.status(204).send();
});

export const reorderBuckets = asyncHandler(async (req: Request, res: Response) => {
  const { bucketIds } = validate(reorderBucketsSchema, req.body);
  const buckets = await roadmapService.reorderBuckets(param(req, 'projectId'), bucketIds);
  res.json(buckets);
});

export const createDefaults = asyncHandler(async (req: Request, res: Response) => {
  const buckets = await roadmapService.createDefaultBuckets(param(req, 'projectId'));
  res.status(201).json(buckets);
});

// ─── Views ────────────────────────────────────────────────────────────────────

export const getTimeline = asyncHandler(async (req: Request, res: Response) => {
  const filters = validate(timelineQuerySchema, req.query);
  const data = await roadmapService.getTimelineData(param(req, 'projectId'), filters);
  res.json(data);
});

export const getBucketsView = asyncHandler(async (req: Request, res: Response) => {
  const filters = validate(bucketsViewQuerySchema, req.query);
  const data = await roadmapService.getBucketsViewData(param(req, 'projectId'), filters);
  res.json(data);
});
