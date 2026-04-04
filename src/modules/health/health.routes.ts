import { Router } from 'express';

import * as healthController from './health.controller';

const router = Router();

router.get('/', healthController.getHealth);
router.get('/metrics', healthController.getMetrics);

export default router;
