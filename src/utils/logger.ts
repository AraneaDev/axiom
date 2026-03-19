type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: { message: string; stack?: string };
}

function log(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
  error?: Error,
): void {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context && { context }),
    ...(error && { error: { message: error.message, stack: error.stack } }),
  };
  const output = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(output + '\n');
  else process.stdout.write(output + '\n');
}

/**
 * Structured JSON logger that writes to stdout (info/warn) or stderr (error).
 */
export const logger = {
  /**
   * Log an informational message.
   * @param message - The log message
   * @param context - Optional key-value context metadata
   */
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  /**
   * Log a warning message.
   * @param message - The log message
   * @param context - Optional key-value context metadata
   */
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  /**
   * Log an error message with optional error object for stack trace capture.
   * @param message - The log message
   * @param context - Optional key-value context metadata
   * @param error - Optional Error object for stack trace
   */
  error: (message: string, context?: Record<string, unknown>, error?: Error) =>
    log('error', message, context, error),
};
