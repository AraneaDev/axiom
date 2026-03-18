import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as savedFiltersController from './saved-filters.controller';

const router = Router();

router.use(authenticate);

router.post('/', savedFiltersController.createFilter);
router.get('/', savedFiltersController.listFilters);
router.patch('/:filterId', savedFiltersController.updateFilter);
router.delete('/:filterId', savedFiltersController.deleteFilter);

export default router;
