import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// The real limiters skip in NODE_ENV=test. Swap in this one with its production limits and no
// skip, so this file checks that the route runs it, ahead of the signature check.
vi.mock('../../middleware/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/rate-limit')>();
  const { default: rateLimit } = await import('express-rate-limit');
  return { ...actual, signedUploadLimiter: rateLimit({ ...actual.SIGNED_UPLOAD_LIMIT }) };
});

const { default: app } = await import('../../index');
const { SIGNED_UPLOAD_LIMIT } = await import('../../middleware/rate-limit');

describe('signed upload rate limit', () => {
  it('slows down probing for upload ids', async () => {
    const statuses: number[] = [];
    for (let i = 0; i <= SIGNED_UPLOAD_LIMIT.max; i++) {
      const res = await request(app).put(`/api/uploads/probe${i}?sig=x`).send('x');
      statuses.push(res.status);
    }
    expect(statuses.slice(0, -1).every((status) => status === 403)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
