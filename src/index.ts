import { createServer } from 'http';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { prisma } from './config/database';
import { env } from './config/env';
import hookRoutes from './git/hook-handler';
import smartHttpRoutes from './git/smart-http.routes';
import { auditMiddleware } from './middleware/auditMiddleware';
import { authenticate } from './middleware/auth';
import { csrfGuard } from './middleware/csrfGuard';
import { errorHandler } from './middleware/errorHandler';
import { globalLimiter, authLimiter, searchLimiter, gitLimiter } from './middleware/rate-limit.js';
import activityRoutes from './modules/activity/activity.routes';
import adminRoutes from './modules/admin/admin.routes';
import attachmentsRoutes from './modules/attachments/attachments.routes';
import auditRoutes from './modules/audit/audit.routes';
import authRoutes from './modules/auth/auth.routes';
import automationRoutes from './modules/automation/automation.routes';
import codeOwnersRoutes from './modules/code-owners/code-owners.routes';
import customFieldsDirectRoutes from './modules/custom-fields/custom-fields-direct.routes';
import customFieldsRoutes from './modules/custom-fields/custom-fields.routes';
import deploymentsRoutes from './modules/deployments/deployments.routes';
import healthRoutes from './modules/health/health.routes';
import invitationsRoutes from './modules/invitations/invitations.routes';
import issueTemplatesRoutes from './modules/issue-templates/issue-templates.routes';
import issuesRoutes from './modules/issues/issues.routes';
import labelsRoutes from './modules/labels/labels.routes';
import linksRoutes from './modules/links/links.routes';
import milestonesRoutes from './modules/milestones/milestones.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import orgsRoutes from './modules/orgs/orgs.routes';
import pipelinesRoutes from './modules/pipelines/pipelines.routes';
import projectsRoutes from './modules/projects/projects.routes';
import pullsRoutes from './modules/pulls/pulls.routes';
import releasesRoutes from './modules/releases/releases.routes';
import insightsRoutes from './modules/repos/insights.routes';
import protectionRoutes from './modules/repos/protection.routes';
import reposRoutes from './modules/repos/repos.routes';
import webhooksRoutes from './modules/repos/webhooks.routes';
import savedFiltersRoutes from './modules/saved-filters/saved-filters.routes';
import searchRoutes from './modules/search/search.routes';
import sprintsRoutes from './modules/sprints/sprints.routes';
import statusChecksRoutes from './modules/status-checks/status-checks.routes';
import teamsRoutes from './modules/teams/teams.routes';
import usersRoutes from './modules/users/users.routes';
import wikiRoutes from './modules/wiki/wiki.routes';
import workflowRoutes from './modules/workflows/workflows.routes';
import { createWebSocketServer } from './realtime/ws-server';
import { logger } from './utils/logger';

// MCP SDK excluded from typecheck — see https://github.com/modelcontextprotocol/typescript-sdk/issues/985

let handleMcpSse: import('express').RequestHandler;
let handleMcpMessage: import('express').RequestHandler;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mcp = require('./mcp/server') as {
    handleMcpSse: import('express').RequestHandler;
    handleMcpMessage: import('express').RequestHandler;
  };
  handleMcpSse = mcp.handleMcpSse;
  handleMcpMessage = mcp.handleMcpMessage;
} catch {
  // MCP SDK may not be available in test environments
  const noop: import('express').RequestHandler = (_req, res) => {
    res.status(501).json({ error: { message: 'MCP not available' } });
  };
  handleMcpSse = noop;
  handleMcpMessage = noop;
}

const app = express();

// Global middleware
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  }),
);
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '5mb' }));

// Rate limiting
app.use(globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/refresh', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/search', searchLimiter);
app.use('/git', gitLimiter);

// CSRF protection: require X-Requested-With header on state-changing requests
app.use('/api', csrfGuard);

// Health check (public, no auth required)
app.use('/api/health', healthRoutes);
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0-alpha', name: 'axiom' });
});

// Audit middleware: registers finish listener to log mutating API requests
app.use('/api', auditMiddleware);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/orgs', orgsRoutes);
app.use('/api', invitationsRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/projects', issuesRoutes);
app.use('/api/projects', activityRoutes);
app.use('/api/projects', sprintsRoutes);
app.use('/api/wiki', wikiRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/repos', reposRoutes);
app.use('/api/repos', insightsRoutes);
app.use('/api/repos', pullsRoutes);
app.use('/api/repos', protectionRoutes);
app.use('/api/repos', webhooksRoutes);
app.use('/api/repos', releasesRoutes);
app.use('/api/repos', pipelinesRoutes);
app.use('/api/repos', statusChecksRoutes);
app.use('/api/repos', codeOwnersRoutes);
app.use('/api/repos', deploymentsRoutes);
app.use('/api/projects', customFieldsRoutes);
app.use('/api/projects', workflowRoutes);
app.use('/api/projects', automationRoutes);
app.use('/api/projects', labelsRoutes);
app.use('/api/projects', issueTemplatesRoutes);
app.use('/api/projects', milestonesRoutes);
app.use('/api/links', linksRoutes);
app.use('/api', customFieldsDirectRoutes);
app.use('/api/attachments', attachmentsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/saved-filters', savedFiltersRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/audit-logs', auditRoutes);

// Git Smart HTTP (must be before JSON body parser doesn't matter — has its own raw parser)
app.use('/git', smartHttpRoutes);

// Internal hooks
app.use('/api/internal/hooks', hookRoutes);

// MCP SSE endpoint
app.get('/api/mcp', authenticate, handleMcpSse);
app.post('/api/mcp/messages', authenticate, handleMcpMessage);

// Error handler (must be last)
app.use(errorHandler);

// Only listen when run directly (not imported by tests)
if (require.main === module) {
  const server = createServer(app);
  server.timeout = 30000;
  server.keepAliveTimeout = 65000;

  createWebSocketServer(server);

  if (process.env.SMTP_HOST) {
    import('./email/queue')
      .then(({ startEmailWorker }) => {
        startEmailWorker();
      })
      .catch((err) => {
        logger.warn('Failed to start email worker', { error: String(err) });
      });
  }

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
