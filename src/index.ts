import { createServer } from 'http';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { handleAct } from './actions/batch';
import { listActions } from './actions/registry';
import { markRegistryRoute, mountActions } from './actions/rest';
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
import { globalLimiter, authLimiter, searchLimiter } from './middleware/rate-limit.js';
import { requestLogger } from './middleware/requestLogger';
import { require2fa } from './middleware/require2fa';
import { mountStaticFrontend, resolveStaticDir } from './middleware/static-frontend';
import activityRoutes from './modules/activity/activity.routes';
import analyticsRoutes from './modules/analytics/analytics.routes';
import approvalActionRoutes from './modules/approvals/approvals-actions.routes';
import approvalGateRoutes from './modules/approvals/approvals.routes';
import { signedUploadRouter } from './modules/attachments/attachments.routes';
import authRoutes from './modules/auth/auth.routes';
import automationRoutes from './modules/automation/automation.routes';
import customFieldsDirectRoutes from './modules/custom-fields/custom-fields-direct.routes';
import customFieldsRoutes from './modules/custom-fields/custom-fields.routes';
import { parseTrustProxy } from './modules/forms/client-ip';
import formRoutes from './modules/forms/forms.routes';
import publicFormRoutes from './modules/forms/public-forms.routes';
import healthRoutes from './modules/health/health.routes';
import intakeRoutes from './modules/intake/intake.routes';
import invitationsRoutes from './modules/invitations/invitations.routes';
import issueTemplatesRoutes from './modules/issue-templates/issue-templates.routes';
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
import './modules/agent-approvals/agent-approvals.actions';
import './modules/agent-approvals/agent-policy.actions';
import './modules/users/users.actions';
import './modules/admin/admin.actions';
import issuesRoutes from './modules/issues/issues.routes';
import labelsRoutes from './modules/labels/labels.routes';
import linksRoutes from './modules/links/links.routes';
import milestonesRoutes from './modules/milestones/milestones.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import orgsRoutes from './modules/orgs/orgs.routes';
import projectsRoutes from './modules/projects/projects.routes';
import roadmapRoutes from './modules/roadmap/roadmap.routes';
import teamRoadmapRoutes from './modules/roadmap/team-roadmap.routes';
import searchRoutes from './modules/search/search.routes';
import siteSettingsRoutes from './modules/site-settings/site-settings.routes';
import teamsRoutes from './modules/teams/teams.routes';
import usersRoutes from './modules/users/users.routes';
import wikiRoutes from './modules/wiki/wiki.routes';
import workflowRoutes from './modules/workflows/workflows.routes';
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

// Public form routes (no auth required)
app.use('/api', publicFormRoutes);

// Health check (public, no auth required)
app.use('/api/health', healthRoutes);

// OpenAPI spec + Scalar docs UI (public, no auth required). Ahead of the routers below: several
// of them run router.use(authenticate) on all of /api, which would answer these with a 401.
app.use('/api', openApiRouter);

// Site settings (public GET, admin PUT — must be before catch-all auth routes)
app.use('/api/site-settings', siteSettingsRoutes);

// 2FA enforcement — after auth, before feature routes
app.use('/api', require2fa);
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0-alpha', name: 'axiom' });
});

// Audit middleware: registers finish listener to log mutating API requests
app.use('/api', auditMiddleware);

// Registry actions come ahead of the legacy routers, so that their router.use middleware never
// runs on a migrated path. An actions file must be imported above to be in this list.
const actionsRouter = express.Router();
mountActions(actionsRouter, listActions());
app.use(actionsRouter);

// Actions by name, and the MCP server. Each action checks the token's scope, so these are registry
// routes, and they sit ahead of the legacy routers whose router.use(authenticate) would ask
// tokenAllows.
app.post('/api/act', markRegistryRoute, authenticate, handleAct);
const mcpAccess = [checkMcpOrigin, markRegistryRoute, authenticate, requireApiToken];
app.post('/api/mcp', mcpAccess, handleMcpPost);
app.get('/api/mcp', mcpAccess, refuseMcpStream);
app.delete('/api/mcp', mcpAccess, refuseMcpStream);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/orgs', orgsRoutes);
app.use('/api', invitationsRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/projects', issuesRoutes);
app.use('/api/projects', activityRoutes);
app.use('/api/wiki', wikiRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/projects', customFieldsRoutes);
app.use('/api/projects', workflowRoutes);
app.use('/api/projects', automationRoutes);
app.use('/api/projects', approvalGateRoutes);
app.use('/api', approvalActionRoutes);
app.use('/api/projects', labelsRoutes);
app.use('/api/projects', issueTemplatesRoutes);
app.use('/api/projects', milestonesRoutes);
app.use('/api/links', linksRoutes);
app.use('/api', customFieldsDirectRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api', analyticsRoutes);
app.use('/api/projects', formRoutes);
app.use('/api/projects', intakeRoutes);
app.use('/api/projects', roadmapRoutes);
app.use('/api', teamRoadmapRoutes);

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
