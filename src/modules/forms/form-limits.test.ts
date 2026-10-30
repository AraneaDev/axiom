/**
 * Form abuse limits are per form and per IP: one sender can't lock out or exhaust a form for
 * everyone. A high form-wide ceiling only guards against floods, and logs when it trips.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { redis } from '../../config/redis';
import { logger } from '../../utils/logger';

import {
  assertSecretAttemptsLeft,
  consumeSubmissionSlot,
  FORM_HOURLY_CEILING,
  recordSecretFailure,
  SECRET_FAILURE_LIMIT,
} from './form-limits';

const ipA = '203.0.113.1';
const ipB = '203.0.113.2';

describe('form limits', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('locks out only the IP that guessed wrong', async () => {
    const formId = `lock-${Date.now()}`;
    for (let i = 0; i < SECRET_FAILURE_LIMIT; i++) await recordSecretFailure(formId, ipA);
    await expect(assertSecretAttemptsLeft(formId, ipA)).rejects.toMatchObject({ statusCode: 429 });
    await expect(assertSecretAttemptsLeft(formId, ipB)).resolves.toBeUndefined();
  });

  it('caps submissions per IP without exhausting the form for others', async () => {
    const form = { id: `cap-${Date.now()}`, rateLimitPerHour: 2 };
    await consumeSubmissionSlot(form, ipA);
    await consumeSubmissionSlot(form, ipA);
    await expect(consumeSubmissionSlot(form, ipA)).rejects.toMatchObject({ statusCode: 429 });
    await expect(consumeSubmissionSlot(form, ipB)).resolves.toBeUndefined();
  });

  it('applies a default per-IP cap when the form sets none', async () => {
    const form = { id: `default-${Date.now()}`, rateLimitPerHour: null };
    const hour = Math.floor(Date.now() / 3_600_000);
    await redis.set(`form:${form.id}:ip:${ipA}:${hour}`, 10_000, 'EX', 3600);
    await expect(consumeSubmissionSlot(form, ipA)).rejects.toMatchObject({ statusCode: 429 });
    await expect(consumeSubmissionSlot(form, ipB)).resolves.toBeUndefined();
  });

  it('stops a flood at the form-wide ceiling and logs it', async () => {
    const form = { id: `flood-${Date.now()}`, rateLimitPerHour: null };
    const hour = Math.floor(Date.now() / 3_600_000);
    await redis.set(`form:${form.id}:total:${hour}`, FORM_HOURLY_CEILING, 'EX', 3600);
    const warn = vi.spyOn(logger, 'warn');
    await expect(consumeSubmissionSlot(form, ipB)).rejects.toMatchObject({ statusCode: 429 });
    expect(warn).toHaveBeenCalled();
  });
});
