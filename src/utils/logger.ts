import os from 'os';

import pino from 'pino';

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['password', 'token', 'authorization', 'cookie', 'secret', '*.password', '*.token'],
    censor: '[REDACTED]',
  },
  base: {
    service: 'axiom-api',
    pid: process.pid,
    ...(process.env.NODE_ENV === 'production' && { hostname: os.hostname() }),
  },
});

function wrapLevel(level: 'info' | 'warn' | 'error' | 'debug' | 'fatal') {
  return (message: string, context?: Record<string, unknown>, error?: Error) => {
    const merged = { ...context, ...(error && { err: error }) };
    if (Object.keys(merged).length > 0) {
      pinoLogger[level](merged, message);
    } else {
      pinoLogger[level](message);
    }
  };
}

function wrapChildLevel(
  childPino: pino.Logger,
  level: 'info' | 'warn' | 'error' | 'debug' | 'fatal',
) {
  return (message: string, context?: Record<string, unknown>, error?: Error) => {
    const merged = { ...context, ...(error && { err: error }) };
    if (Object.keys(merged).length > 0) {
      childPino[level](merged, message);
    } else {
      childPino[level](message);
    }
  };
}

/**
 * Structured JSON logger powered by Pino.
 * All levels: debug, info, warn, error, fatal.
 * Sensitive fields (password, token, etc.) auto-redacted.
 */
export const logger = {
  debug: wrapLevel('debug'),
  info: wrapLevel('info'),
  warn: wrapLevel('warn'),
  error: wrapLevel('error'),
  fatal: wrapLevel('fatal'),

  child: (bindings: Record<string, unknown>) => {
    const childPino = pinoLogger.child(bindings);
    return {
      debug: wrapChildLevel(childPino, 'debug'),
      info: wrapChildLevel(childPino, 'info'),
      warn: wrapChildLevel(childPino, 'warn'),
      error: wrapChildLevel(childPino, 'error'),
      fatal: wrapChildLevel(childPino, 'fatal'),
    };
  },
};

export type Logger = typeof logger;
export type ChildLogger = ReturnType<typeof logger.child>;
