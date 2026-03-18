import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as searchController from './search.controller';

const router = Router();

router.use(authenticate);
router.get('/', searchController.search);

export default router;
