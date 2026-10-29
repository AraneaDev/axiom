import { apiReference } from '@scalar/express-api-reference';
import { Router } from 'express';

// Import route registrations (side-effect: registers paths)
import './routes/auth';
import './routes/issues';
import './routes/wiki';

import { createOpenAPISpec } from './registry';

const router = Router();

router.get('/openapi.json', (_req, res) => {
  res.json(createOpenAPISpec());
});

router.use(
  '/docs',
  apiReference({
    spec: { url: '/api/openapi.json' },
  }),
);

export { router as openApiRouter };
