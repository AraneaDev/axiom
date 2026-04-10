import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

import * as roadmapController from './roadmap.controller';

const router = Router();
router.use(authenticate);

router.get('/:projectId/roadmap/buckets', requireProjectAccess, roadmapController.listBuckets);
router.post('/:projectId/roadmap/buckets', requireProjectAccess, roadmapController.createBucket);
router.post(
  '/:projectId/roadmap/buckets/defaults',
  requireProjectAccess,
  roadmapController.createDefaults,
);
router.post(
  '/:projectId/roadmap/buckets/reorder',
  requireProjectAccess,
  roadmapController.reorderBuckets,
);
router.patch(
  '/:projectId/roadmap/buckets/:id',
  requireProjectAccess,
  roadmapController.updateBucket,
);
router.delete(
  '/:projectId/roadmap/buckets/:id',
  requireProjectAccess,
  roadmapController.deleteBucket,
);
router.get('/:projectId/roadmap/timeline', requireProjectAccess, roadmapController.getTimeline);
router.get(
  '/:projectId/roadmap/buckets-view',
  requireProjectAccess,
  roadmapController.getBucketsView,
);

export default router;
