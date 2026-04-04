import { describe, it, expect } from 'vitest';

import { logger } from './logger';

describe('logger', () => {
  it('exposes all log levels', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('creates child loggers with bound context', () => {
    const child = logger.child({ requestId: 'test-123' });
    expect(typeof child.info).toBe('function');
    expect(typeof child.debug).toBe('function');
    expect(typeof child.fatal).toBe('function');
  });
});
