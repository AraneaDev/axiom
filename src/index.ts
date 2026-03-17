import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';

// Route imports
import authRoutes from './modules/auth/auth.routes';
import usersRoutes from './modules/users/users.routes';
import orgsRoutes from './modules/orgs/orgs.routes';
import teamsRoutes from './modules/teams/teams.routes';
import projectsRoutes from './modules/projects/projects.routes';
import issuesRoutes from './modules/issues/issues.routes';
import wikiRoutes from './modules/wiki/wiki.routes';
import searchRoutes from './modules/search/search.routes';
import reposRoutes from './modules/repos/repos.routes';
import pullsRoutes from './modules/pulls/pulls.routes';
import protectionRoutes from './modules/repos/protection.routes';
import webhooksRoutes from './modules/repos/webhooks.routes';
import smartHttpRoutes from './git/smart-http.routes';
import hookRoutes from './git/hook-handler';
import { handleMcpSse, handleMcpMessage } from './mcp/server';
import { authenticate } from './middleware/auth';
import releasesRoutes from './modules/releases/releases.routes';
import pipelinesRoutes from './modules/pipelines/pipelines.routes';

const app = express();

// Global middleware
app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
  credentials: true,
}));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '5mb' }));

// Rate limiting
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
});
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many requests, please try again later.', code: 'RATE_LIMITED' } },
  skip: () => env.NODE_ENV === 'test',
});
app.use(globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/refresh', authLimiter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0-alpha', name: 'axiom' });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/orgs', orgsRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/projects', issuesRoutes);
app.use('/api/wiki', wikiRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/repos', reposRoutes);
app.use('/api/repos', pullsRoutes);
app.use('/api/repos', protectionRoutes);
app.use('/api/repos', webhooksRoutes);
app.use('/api/repos', releasesRoutes);
app.use('/api/repos', pipelinesRoutes);

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
  app.listen(env.PORT, () => {
    console.log(`Axiom API running on port ${env.PORT} [${env.NODE_ENV}]`);
  });
}

export default app;
