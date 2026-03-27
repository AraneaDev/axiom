import { Queue, Worker } from 'bullmq';

import { getFromAddress, getTransporter } from '../config/email';
import { logger } from '../utils/logger';

import { renderEmailTemplate } from './templates';

interface EmailJobData {
  to: string;
  recipientName: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function parseRedisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

const connection = parseRedisConnection(REDIS_URL);

export const emailQueue = new Queue<EmailJobData>('email', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

let worker: Worker<EmailJobData> | null = null;

/**
 *
 */
export function startEmailWorker(): void {
  const transporter = getTransporter();
  if (!transporter) {
    logger.info('Email worker not started: no SMTP transporter');
    return;
  }

  worker = new Worker<EmailJobData>(
    'email',
    async (job) => {
      const { to, recipientName, type, title, body, link } = job.data;
      const { subject, html, text } = renderEmailTemplate(type, {
        recipientName,
        title,
        body,
        link,
        appUrl: process.env.FRONTEND_URL || 'http://localhost:7000',
      });

      await transporter.sendMail({
        from: getFromAddress(),
        to,
        subject,
        html,
        text,
      });

      logger.info('Email sent', { to, type, subject });
    },
    {
      connection,
      concurrency: 5,
      limiter: { max: 10, duration: 1000 },
    },
  );

  worker.on('failed', (job, err) => {
    logger.warn('Email job failed', {
      jobId: job?.id,
      type: job?.data.type,
      to: job?.data.to,
      error: String(err),
      attempt: job?.attemptsMade,
    });
  });

  worker.on('error', (err) => {
    logger.error('Email worker error', { error: String(err) });
  });

  logger.info('Email worker started');
}

/**
 *
 */
export async function stopEmailWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  await emailQueue.close();
}
