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

  it('logs API requests on finish but not served frontend requests', async () => {
    const { requestLogger } = await import('./requestLogger');
    const finishFor = (url: string, statusCode = 200) => {
      const req = { method: 'GET', originalUrl: url, headers: {} } as Request;
      let onFinish = () => {};
      const res = {
        setHeader: vi.fn(),
        on: vi.fn((_e: string, cb: () => void) => (onFinish = cb)),
        getHeader: vi.fn(),
        statusCode,
      } as unknown as Response;
      requestLogger(req, res, vi.fn() as NextFunction);
      const info = vi.spyOn(req.log, 'info');
      const error = vi.spyOn(req.log, 'error');
      onFinish();
      return info.mock.calls.length + error.mock.calls.length;
    };

    expect(finishFor('/api/issues?x=1')).toBe(1);
    expect(finishFor('/health')).toBe(1);
    expect(finishFor('/assets/index-abc.js')).toBe(0);
    expect(finishFor('/aranea-dev/axiom/issues/1?tab=x')).toBe(0);
    // A server error on a frontend path is still worth a log line.
    expect(finishFor('/assets/index-abc.js', 500)).toBe(1);
  });
});
