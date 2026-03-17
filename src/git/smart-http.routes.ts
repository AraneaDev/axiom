import { Router } from 'express';
import express from 'express';
import { handleInfoRefs, handleServiceRpc } from './smart-http';

const router = Router();

// Disable JSON body parsing for git routes — we need raw streams
router.use(express.raw({ type: 'application/x-git-*', limit: '100mb' }));

// Discovery: GET /:org/:team/:repo.git/info/refs?service=...
router.get('/:org/:team/:repo.git/info/refs', handleInfoRefs);

// Data transfer: POST /:org/:team/:repo.git/git-upload-pack|git-receive-pack
router.post('/:org/:team/:repo.git/:service(git-upload-pack|git-receive-pack)', handleServiceRpc);

export default router;
