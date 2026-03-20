import { createTransport, type Transporter } from 'nodemailer';

import { logger } from '../utils/logger';

let transporter: Transporter | null = null;

const host = process.env.SMTP_HOST;
const port = parseInt(process.env.SMTP_PORT || '25', 10);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM || 'Axiom <noreply@axiom.local>';

if (host) {
  transporter = createTransport({
    host,
    port,
    secure: port === 465,
    ...(user && pass ? { auth: { user, pass } } : {}),
    tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
  });

  transporter
    .verify()
    .then(() => {
      logger.info('SMTP transporter verified', { host, port });
    })
    .catch((err) => {
      logger.warn('SMTP transporter verification failed', { host, port, error: String(err) });
    });
} else {
  logger.info('SMTP not configured, email delivery disabled');
}

/**
 *
 */
export function getTransporter(): Transporter | null {
  return transporter;
}

/**
 *
 */
export function getFromAddress(): string {
  return from;
}
