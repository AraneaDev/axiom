import { createServer } from 'http';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { handleAct } from './actions/batch';
import { listActions } from './actions/registry';
import { mountActions } from './actions/rest';
import { prisma } from './config/database';
import { env } from './config/env';
import { openApiRouter } from './lib/openapi';
import { requestContextMiddleware } from './lib/request-context';
import {
  checkMcpOrigin,
  handleMcpPost,
  refuseMcpStream,
  requireApiToken,
} from './mcp/agent-server';
import { auditMiddleware } from './middleware/auditMiddleware';
import { authenticate } from './middleware/auth';
import { csrfGuard } from './middleware/csrfGuard';
import { errorHandler } from './middleware/errorHandler';
import { metricsCollector } from './middleware/metricsCollector';
import { nulGuard } from './middleware/nulGuard';
import {
  globalLimiter,
  authLimiter,
  searchLimiter,
  GITHUB_WEBHOOK_PATH,
  githubWebhookLimiter,
} from './middleware/rate-limit.js';
import { requestLogger } from './middleware/requestLogger';
import { require2fa } from './middleware/require2fa';
import { mountStaticFrontend, resolveStaticDir } from './middleware/static-frontend';
import { signedUploadRouter } from './modules/attachments/attachments.routes';
import { parseTrustProxy } from './modules/forms/client-ip';
import { githubWebhookGate } from './modules/github/webhook-gate';
import './actions/read.actions';
import './modules/attachments/attachments.actions';
import './modules/issues/issues.actions';
import './modules/wiki/wiki.actions';
import './modules/orgs/orgs.actions';
import './modules/invitations/invitations.actions';
import './modules/teams/teams.actions';
import './modules/projects/projects.actions';
import './modules/sprints/sprints.actions';
import './modules/search/search.actions';
import './modules/search/query.actions';
import './modules/saved-filters/saved-filters.actions';
import './modules/dashboards/dashboards.actions';
import './modules/roadmap/roadmap.actions';
import './modules/issues/board.actions';
import './modules/labels/labels.actions';
import './modules/milestones/milestones.actions';
import './modules/issue-templates/issue-templates.actions';
import './modules/custom-fields/custom-fields.actions';
import './modules/intake/intake.actions';
import './modules/agent-approvals/agent-approvals.actions';
import './modules/agent-approvals/agent-policy.actions';
import './modules/users/users.actions';
import './modules/workflows/workflows.actions';
import './modules/automation/automation.actions';
import './modules/approvals/approvals.actions';
import './modules/forms/forms.actions';
import './modules/forms/public-forms.actions';
import './modules/admin/admin.actions';
import './modules/notifications/notifications.actions';
import './modules/activity/activity.actions';
import './modules/analytics/analytics.actions';
import './modules/links/links.actions';
import './modules/auth/auth.actions';
import './modules/health/health.actions';
import './modules/site-settings/site-settings.actions';
import './modules/github/github-account.actions';
import './modules/github/github-app.actions';
import './modules/github/webhook-handlers';
import './modules/github/webhook.actions';
import { createWebSocketServer } from './realtime/ws-server';
import { logger } from './utils/logger';

const app = express();

// Trust proxy hops as TRUST_PROXY says (default: one hop in production), so req.ip is the
// client's address behind a reverse proxy or tunnel. See src/modules/forms/client-ip.ts
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY, process.env.NODE_ENV);
if (trustProxy !== undefined) app.set('trust proxy', trustProxy);

// Global middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // TLS and HSTS belong to the host reverse proxy. Upgrading here would blank the
        // page for anyone reaching the app over plain HTTP on a non-localhost host.
        'upgrade-insecure-requests': null,
        // Explicit ws:/wss: for the realtime socket; older Safari does not match them to 'self'.
        'connect-src': ["'self'", 'ws:', 'wss:'],
        // Attachment thumbnails/previews use blob: URLs; editors embed external https images.
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        // The PDF attachment preview renders an iframe with a blob: URL.
        'frame-src': ["'self'", 'blob:'],
        // Audio/video attachment previews play from blob: URLs.
        'media-src': ["'self'", 'blob:'],
      },
    },
  }),
);
app.use(
  cors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  }),
);
app.use(requestLogger);
app.use(metricsCollector);
// PUT /api/uploads/:uploadId has its signature as credential and its own limits. It sits ahead of
// the JSON parser, the CSRF guard and require2fa, and nothing else takes this way past them.
app.use(signedUploadRouter);
// POST /api/github/webhook is signed over the exact bytes GitHub sent, so its body stays a Buffer:
// parsed and re-serialised JSON would not verify. GitHub caps a delivery at 25 MB. The signature
// is checked in the action, before anything is parsed. express.json skips a body read here.
// The limiter and the gate go first: a caller that is counted out or refused is answered before
// the server reads any of its body.
app.use(
  GITHUB_WEBHOOK_PATH,
  githubWebhookLimiter,
  githubWebhookGate,
  express.raw({ type: '*/*', limit: '25mb' }),
);
app.use(express.json({ limit: '5mb' }));
app.use('/api', nulGuard);

app.use(requestContextMiddleware);

// Rate limiting. The global limit covers the API only: one page load fetches many
// static assets, and users behind one NAT would otherwise get 429 blank pages.
app.use('/api', globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/refresh', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/search', searchLimiter);

// CSRF protection: require X-Requested-With header on state-changing requests
app.use('/api', csrfGuard);

// OpenAPI spec + Scalar docs UI (public, no auth required). Ahead of the catch-all below, which
// would answer these with a 401.
app.use('/api', openApiRouter);

// 2FA enforcement — after auth, before feature routes
app.use('/api', require2fa);
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0-alpha', name: 'axiom' });
});

// Audit middleware: registers finish listener to log mutating API requests
app.use('/api', auditMiddleware);

// Every action's REST binding. An actions file must be imported above to be in this list.
const actionsRouter = express.Router();
mountActions(actionsRouter, listActions());
app.use(actionsRouter);

// Actions by name, and the MCP server. Each action checks the token's scope.
app.post('/api/act', authenticate, handleAct);
const mcpAccess = [checkMcpOrigin, authenticate, requireApiToken];
app.post('/api/mcp', mcpAccess, handleMcpPost);
app.get('/api/mcp', mcpAccess, refuseMcpStream);
app.delete('/api/mcp', mcpAccess, refuseMcpStream);

// Whatever no route above served asks for credentials before the 404 below. A stranger gets the
// same 401 on an unknown path as on a real one, so the API can't be mapped without signing in,
// and a token and a session then get the same 404: neither learns more than "not found".
app.use('/api', authenticate);

// Unknown /api routes get a JSON 404, never the SPA index.html
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { message: 'Not found' } });
});

// Built frontend (production, or whenever STATIC_DIR is set). After all API routes.
if (process.env.NODE_ENV === 'production' || env.STATIC_DIR) {
  mountStaticFrontend(app, resolveStaticDir(env.STATIC_DIR));
}

// Error handler (must be last)
app.use(errorHandler);

// Only listen when run directly (not imported by tests)
if (require.main === module) {
  const server = createServer(app);
  server.timeout = 30000;
  server.keepAliveTimeout = 65000;

  createWebSocketServer(server);

  server.listen(env.PORT, () => {
    logger.info('Axiom API running', { port: env.PORT, env: env.NODE_ENV });
    if (process.env.NODE_ENV === 'production' && process.env.CORS_ORIGIN === '*') {
      logger.warn('CORS_ORIGIN is set to wildcard in production', { env: 'production' });
    }
  });

  function gracefulShutdown(signal: string) {
    logger.info('Graceful shutdown initiated', { signal });
    server.close(async () => {
      logger.info('HTTP server closed');
      await prisma.$disconnect();
      logger.info('Database disconnected');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forced exit after timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

export default app;
