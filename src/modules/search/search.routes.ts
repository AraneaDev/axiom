import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as searchController from './search.controller';

const router = Router();

router.use(authenticate);
router.get('/', searchController.search);
router.get('/code', searchController.searchCodeEndpoint);
router.get('/saved', searchController.getSavedSearches);
router.post('/saved', searchController.createSavedSearch);
router.delete('/saved/:id', searchController.deleteSavedSearch);

export default router;
