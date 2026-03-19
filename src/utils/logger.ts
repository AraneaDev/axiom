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

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>, error?: Error) =>
    log('error', message, context, error),
};
