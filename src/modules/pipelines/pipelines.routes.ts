import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import * as ctrl from './pipelines.controller';

const router = Router();

// Pipeline CRUD
router.get('/:repoId/pipelines', authenticate, ctrl.listPipelines);
router.post('/:repoId/pipelines', authenticate, ctrl.createPipeline);
router.put('/:repoId/pipelines/:pipelineId', authenticate, ctrl.updatePipeline);
router.delete('/:repoId/pipelines/:pipelineId', authenticate, ctrl.deletePipeline);

// Runs
router.get('/:repoId/runs', authenticate, ctrl.listRuns);
router.get('/:repoId/runs/:runId', authenticate, ctrl.getRun);
router.post('/:repoId/pipelines/:pipelineId/runs', authenticate, ctrl.triggerRun);
router.post('/:repoId/runs/:runId/cancel', authenticate, ctrl.cancelRun);
router.get('/:repoId/runs/:runId/logs', authenticate, ctrl.streamLogs);

export default router;
