/**
 * Abuse limits for public forms, counted atomically in Redis:
 * - a gated form stops checking secrets for 15 minutes after 20 wrong ones, however they
 *   arrive (GET with X-Form-Secret, submit or verify), so the secret can't be guessed
 *   through the cheaper GET;
 * - rateLimitPerHour caps submissions per IP per form, and every form takes at most
 *   FORM_HOURLY_CAP submissions an hour in total, so a distributed sender is capped too.
 * When Redis is down, secret failures are not counted and the per-IP cap falls back to a
 * database count (not atomic).
 */
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { AppError } from '../../middleware/errorHandler';

export const SECRET_FAILURE_LIMIT = 20;
const SECRET_LOCK_SECONDS = 15 * 60;
/** Total submissions one form accepts per hour, from all senders */
export const FORM_HOURLY_CAP = 500;

const failKey = (formId: string) => `form:${formId}:secret-failures`;

/**
 * Refuse while a form is locked out after too many wrong secrets.
 * @param formId
 * @throws {AppError} 429 during the lockout
 */
export async function assertSecretAttemptsLeft(formId: string): Promise<void> {
  const count = Number(await redis.get(failKey(formId)).catch(() => null)) || 0;
  if (count >= SECRET_FAILURE_LIMIT) {
    throw new AppError(429, 'Too many wrong access codes for this form, try again later');
  }
}

/**
 * Count a wrong secret for a form.
 * @param formId
 */
export async function recordSecretFailure(formId: string): Promise<void> {
  try {
    const count = await redis.incr(failKey(formId));
    if (count === 1) await redis.expire(failKey(formId), SECRET_LOCK_SECONDS);
  } catch {
    // Redis down: nothing to count with
  }
}

async function incrWithExpiry(key: string, seconds: number): Promise<number> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, seconds);
  return count;
}

/**
 * Take one submission slot for a form and sender, or refuse.
 * @param form - The form's id and rateLimitPerHour
 * @param form.id
 * @param form.rateLimitPerHour
 * @param ip - The sender's IP
 * @throws {AppError} 429 when the sender or the form is over its hourly limit
 */
export async function consumeSubmissionSlot(
  form: { id: string; rateLimitPerHour: number | null },
  ip: string,
): Promise<void> {
  const hour = Math.floor(Date.now() / 3_600_000);
  try {
    if (form.rateLimitPerHour) {
      const mine = await incrWithExpiry(`form:${form.id}:ip:${ip}:${hour}`, 3600);
      if (mine > form.rateLimitPerHour) {
        throw new AppError(429, 'Too many submissions for this form, try again later');
      }
    }
    const total = await incrWithExpiry(`form:${form.id}:total:${hour}`, 3600);
    if (total > FORM_HOURLY_CAP) {
      throw new AppError(429, 'This form is receiving too many submissions, try again later');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Redis down: fall back to counting this sender's submissions in the database
    if (!form.rateLimitPerHour) return;
    const recent = await prisma.formSubmission.count({
      where: {
        formId: form.id,
        submitterIp: ip,
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
    });
    if (recent >= form.rateLimitPerHour) {
      throw new AppError(429, 'Too many submissions for this form, try again later');
    }
  }
}
