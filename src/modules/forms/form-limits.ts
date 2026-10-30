/**
 * Abuse limits for public forms, counted atomically in Redis and keyed per form AND per IP,
 * so one sender can neither lock a gated form for everyone nor use up its quota:
 * - an IP that sends 20 wrong secrets to a form is refused for 15 minutes; other IPs,
 *   including everyone with the right secret, are not affected;
 * - each IP may submit rateLimitPerHour times an hour to a form (DEFAULT_PER_IP_PER_HOUR
 *   when the form sets none);
 * - a form-wide ceiling of FORM_HOURLY_CEILING submissions an hour only guards against
 *   floods from many IPs, and logs a warning when it trips.
 * When Redis is down, secret failures are not counted and the per-IP cap falls back to a
 * database count (not atomic).
 */
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

export const SECRET_FAILURE_LIMIT = 20;
const SECRET_LOCK_SECONDS = 15 * 60;
/** Per-IP hourly submissions to a form that sets no rateLimitPerHour */
export const DEFAULT_PER_IP_PER_HOUR = 500;
/** Flood guard: total submissions one form accepts per hour, from all senders */
export const FORM_HOURLY_CEILING = 5000;

const failKey = (formId: string, ip: string) => `form:${formId}:secret-failures:${ip}`;

/**
 * Refuse while this IP is locked out of a form after too many wrong secrets.
 * @param formId
 * @param ip - The sender's IP
 * @throws {AppError} 429 during the lockout
 */
export async function assertSecretAttemptsLeft(formId: string, ip: string): Promise<void> {
  const count = Number(await redis.get(failKey(formId, ip)).catch(() => null)) || 0;
  if (count >= SECRET_FAILURE_LIMIT) {
    throw new AppError(429, 'Too many wrong access codes for this form, try again later');
  }
}

/**
 * Count a wrong secret from one IP for a form.
 * @param formId
 * @param ip - The sender's IP
 */
export async function recordSecretFailure(formId: string, ip: string): Promise<void> {
  try {
    await incrWithExpiry(failKey(formId, ip), SECRET_LOCK_SECONDS);
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
 * @throws {AppError} 429 when the sender is over its hourly limit, or the form is flooded
 */
export async function consumeSubmissionSlot(
  form: { id: string; rateLimitPerHour: number | null },
  ip: string,
): Promise<void> {
  const hour = Math.floor(Date.now() / 3_600_000);
  const perIp = form.rateLimitPerHour ?? DEFAULT_PER_IP_PER_HOUR;
  try {
    const mine = await incrWithExpiry(`form:${form.id}:ip:${ip}:${hour}`, 3600);
    if (mine > perIp) {
      throw new AppError(429, 'Too many submissions for this form, try again later');
    }
    const total = await incrWithExpiry(`form:${form.id}:total:${hour}`, 3600);
    if (total > FORM_HOURLY_CEILING) {
      logger.warn('Public form hit its hourly flood ceiling', { formId: form.id, total });
      throw new AppError(429, 'This form is receiving too many submissions, try again later');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Redis down: fall back to counting this sender's submissions in the database
    const recent = await prisma.formSubmission.count({
      where: {
        formId: form.id,
        submitterIp: ip,
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
    });
    if (recent >= perIp) {
      throw new AppError(429, 'Too many submissions for this form, try again later');
    }
  }
}
