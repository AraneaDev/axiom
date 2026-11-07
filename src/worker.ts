import './config/load-env';

import { prisma } from './config/database';
import { assertRedisEnabled } from './config/redis-guard';
import {
  clearDecidedAgentApprovals,
  expireAgentApprovals,
  failStuckAgentApprovals,
} from './modules/agent-approvals/agent-approvals.cleanup';
import { cleanupExpiredUploads } from './modules/attachments/upload-intents.service';
import './modules/github/github-resolvers';
import './modules/github/webhook-handlers';
import { cleanupAutomationMarks } from './modules/github/github-automation';
import { reconcileDueRepos } from './modules/github/reconcile.service';
import { cleanupDeliveries, retryDueDeliveries } from './modules/github/webhook.service';
import { closeRealtimePublisher, setRealtimeMode } from './realtime/bridge';
import { logger } from './utils/logger';

const UPLOAD_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const APPROVAL_CLEANUP_INTERVAL_MS = 60 * 1000;
const GITHUB_RECONCILE_TICK_MS = 60 * 1000;
const GITHUB_MARK_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let reconcileRunning = false;
let markCleanupRunning = false;

/** Remove expired upload URLs and staged attachments; a failure waits for the next round. */
function runUploadCleanup(): void {
  cleanupExpiredUploads().catch((err) => {
    logger.error('Upload cleanup failed', {}, err as Error);
  });
}

/** Expire waiting agent approvals, close stuck ones, clear old ones; a failure waits a round. */
function runApprovalCleanup(): void {
  Promise.all([
    expireAgentApprovals(),
    failStuckAgentApprovals(),
    clearDecidedAgentApprovals(),
  ]).catch((err) => {
    logger.error('Agent approval cleanup failed', {}, err as Error);
  });
}

/** Retry the GitHub deliveries that are due and trim the log; a failure waits for the next round. */
function runGithubDeliveryJobs(): void {
  retryDueDeliveries()
    .then(() => cleanupDeliveries())
    .catch((err) => {
      logger.error('GitHub delivery jobs failed', {}, err as Error);
    });
}

/** Reconcile the linked repositories that are due; a failure is on the link and waits for its next round. */
function runGithubReconcile(): void {
  // A round of five links can outlast the tick: the next one waits for it
  if (reconcileRunning) return;
  reconcileRunning = true;
  reconcileDueRepos()
    .catch((err) => {
      logger.error('GitHub reconcile failed', {}, err as Error);
    })
    .finally(() => {
      reconcileRunning = false;
    });
}

/** Delete the GitHub comment marks older than 90 days; one run at a time, a failure waits a day. */
function runGithubMarkCleanup(): void {
  if (markCleanupRunning) return;
  markCleanupRunning = true;
  cleanupAutomationMarks()
    .catch((err) => {
      logger.error('GitHub automation mark cleanup failed', {}, err as Error);
    })
    .finally(() => {
      markCleanupRunning = false;
    });
}

async function main(): Promise<void> {
  assertRedisEnabled();
  // The worker has no sockets: what it stores reaches browsers through the API over Redis
  setRealtimeMode('redis');

  let stopEmail: (() => Promise<void>) | null = null;
  if (process.env.SMTP_HOST) {
    const { startEmailWorker, stopEmailWorker } = await import('./email/queue');
    startEmailWorker();
    stopEmail = stopEmailWorker;
  } else {
    logger.info('SMTP_HOST not set, email worker disabled');
  }

  runUploadCleanup();
  const uploadCleanup = setInterval(runUploadCleanup, UPLOAD_CLEANUP_INTERVAL_MS);
  runApprovalCleanup();
  const approvalCleanup = setInterval(runApprovalCleanup, APPROVAL_CLEANUP_INTERVAL_MS);

  runGithubDeliveryJobs();
  const githubDeliveries = setInterval(runGithubDeliveryJobs, APPROVAL_CLEANUP_INTERVAL_MS);

  runGithubReconcile();
  const githubReconcile = setInterval(runGithubReconcile, GITHUB_RECONCILE_TICK_MS);

  runGithubMarkCleanup();
  const githubMarkCleanup = setInterval(runGithubMarkCleanup, GITHUB_MARK_CLEANUP_INTERVAL_MS);

  logger.info('Axiom worker running');

  const shutdown = async (signal: string) => {
    logger.info('Worker shutting down', { signal });
    clearInterval(uploadCleanup);
    clearInterval(approvalCleanup);
    clearInterval(githubDeliveries);
    clearInterval(githubReconcile);
    clearInterval(githubMarkCleanup);
    closeRealtimePublisher();
    if (stopEmail) await stopEmail();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Worker failed to start', {}, err as Error);
  process.exit(1);
});
