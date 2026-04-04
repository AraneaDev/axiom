import type { Request, Response, NextFunction } from 'express';
import { describe, it, expect, vi } from 'vitest';

describe('requestLogger middleware', () => {
  it('attaches a requestId to req', async () => {
    const { requestLogger } = await import('./requestLogger');
    const req = { method: 'GET', originalUrl: '/api/test', headers: {} } as Request;
    const res = {
      setHeader: vi.fn(),
      on: vi.fn(),
      statusCode: 200,
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    requestLogger(req, res, next);

    expect(req.requestId).toBeDefined();
    expect(typeof req.requestId).toBe('string');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
    expect(next).toHaveBeenCalled();
  });

  it('reuses X-Request-Id from incoming header if present', async () => {
    const { requestLogger } = await import('./requestLogger');
    const req = {
      method: 'GET',
      originalUrl: '/api/test',
      headers: { 'x-request-id': 'existing-id' },
    } as unknown as Request;
    const res = {
      setHeader: vi.fn(),
      on: vi.fn(),
      statusCode: 200,
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    requestLogger(req, res, next);

    expect((req as unknown as { requestId: string }).requestId).toBe('existing-id');
  });
});
