import pino from 'pino';

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Structured JSON logger powered by pino.
 * Maintains backward-compatible API: info/warn/error with optional context object.
 * Adds child() for request-scoped loggers with bound context.
 */
export const logger = {
  info: (message: string, context?: Record<string, unknown>) =>
    context ? pinoLogger.info(context, message) : pinoLogger.info(message),

  warn: (message: string, context?: Record<string, unknown>) =>
    context ? pinoLogger.warn(context, message) : pinoLogger.warn(message),

  error: (message: string, context?: Record<string, unknown>, error?: Error) => {
    const merged = { ...context, ...(error && { err: error }) };
    pinoLogger.error(merged, message);
  },

  child: (bindings: Record<string, unknown>) => {
    const childPino = pinoLogger.child(bindings);
    return {
      info: (message: string, context?: Record<string, unknown>) =>
        context ? childPino.info(context, message) : childPino.info(message),
      warn: (message: string, context?: Record<string, unknown>) =>
        context ? childPino.warn(context, message) : childPino.warn(message),
      error: (message: string, context?: Record<string, unknown>, error?: Error) => {
        const merged = { ...context, ...(error && { err: error }) };
        childPino.error(merged, message);
      },
    };
  },
};

export type Logger = typeof logger;
export type ChildLogger = ReturnType<typeof logger.child>;
