import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pino writes ALL levels to stdout (unlike the old custom logger which split stdout/stderr).
// This is an intentional behavior change — pino unifies output for structured log aggregation.
describe('logger', () => {
  let output: string[];

  beforeEach(() => {
    output = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(chunk.toString());
      return true;
    });
  });

  it('exports info, warn, and error methods', async () => {
    const { logger } = await import('./logger');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('info writes structured JSON to stdout', async () => {
    const { logger } = await import('./logger');
    logger.info('test message', { key: 'value' });
    expect(output.length).toBeGreaterThan(0);
    const parsed = JSON.parse(output[0]);
    expect(parsed.msg).toBe('test message');
    expect(parsed.key).toBe('value');
    expect(parsed.level).toBeDefined();
    expect(parsed.time).toBeDefined();
  });

  it('error includes error stack when provided', async () => {
    const { logger } = await import('./logger');
    const err = new Error('boom');
    logger.error('failure', {}, err);
    const parsed = JSON.parse(output[0]);
    expect(parsed.msg).toBe('failure');
    expect(parsed.err).toBeDefined();
    expect(parsed.err.stack).toContain('boom');
  });

  it('child creates a logger with bound context', async () => {
    const { logger } = await import('./logger');
    const child = logger.child({ requestId: 'abc-123' });
    child.info('child message');
    const parsed = JSON.parse(output[0]);
    expect(parsed.requestId).toBe('abc-123');
    expect(parsed.msg).toBe('child message');
  });
});
