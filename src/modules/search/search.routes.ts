import { Router } from 'express';
import * as searchController from './search.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', searchController.search);

export default router;
