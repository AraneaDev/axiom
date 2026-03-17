import { Router } from 'express';
import * as wikiController from './wiki.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();

router.use(authenticate);

// Wiki spaces (scoped to team)
router.post('/team/:teamId/spaces', wikiController.createSpace);
router.get('/team/:teamId/spaces', wikiController.listSpaces);

// Space operations
router.get('/spaces/:spaceId', wikiController.getSpace);
router.get('/spaces/:spaceId/tree', wikiController.pageTree);

// Pages
router.post('/spaces/:spaceId/pages', wikiController.createPage);
router.get('/spaces/:spaceId/pages/:pageSlug', wikiController.getPage);
router.patch('/spaces/:spaceId/pages/:pageSlug', wikiController.updatePage);
router.delete('/spaces/:spaceId/pages/:pageSlug', wikiController.deletePage);
router.get('/spaces/:spaceId/pages/:pageSlug/history', wikiController.pageHistory);

export default router;
