import { describe, it, expect, vi, afterEach } from 'vitest';

import { logger } from './logger';

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should write info messages to stdout as JSON', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('test info message', { requestId: '123' });
    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('test info message');
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.context.requestId).toBe('123');
  });

  it('should write warn messages to stdout as JSON', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.warn('test warning');
    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.level).toBe('warn');
    expect(parsed.message).toBe('test warning');
  });

  it('should write error messages to stderr with error object', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const err = new Error('something broke');
    logger.error('failure occurred', { module: 'auth' }, err);
    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.level).toBe('error');
    expect(parsed.message).toBe('failure occurred');
    expect(parsed.context.module).toBe('auth');
    expect(parsed.error.message).toBe('something broke');
    expect(parsed.error.stack).toBeDefined();
  });

  it('should include ISO timestamp in output', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('timestamp test');
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
  });

  it('should omit context when not provided', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('no context');
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.context).toBeUndefined();
  });
});
