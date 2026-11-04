import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { logger } from '../utils/logger';

import { errorHandler } from './errorHandler';

/**
 * Run the handler on an error, and return the status it answered with.
 * @param err
 */
function statusFor(err: Error): number {
  const status = vi.fn(() => ({ json: vi.fn() }));
  const req = { originalUrl: '/api/x', method: 'GET' } as unknown as Request;
  errorHandler(err, req, { status } as unknown as Response, vi.fn() as NextFunction);
  return (status.mock.calls[0] as unknown as [number])[0];
}

describe('errorHandler and URIError', () => {
  it("answers the router's own status for a malformed escape in a param", () => {
    const err = Object.assign(new URIError('Failed to decode param'), { status: 400 });
    expect(statusFor(err)).toBe(400);
  });

  it('treats a URIError from a handler as the bug it is', () => {
    const fatal = vi.spyOn(logger, 'fatal').mockImplementation(() => {});
    expect(statusFor(new URIError('URI malformed'))).toBe(500);
    expect(fatal).toHaveBeenCalledOnce();
    fatal.mockRestore();
  });
});
