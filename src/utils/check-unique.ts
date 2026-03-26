import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';

/**
 *
 * @param model
 * @param where
 * @param message
 */
export async function checkUnique(
  model: string,
  where: Record<string, unknown>,
  message: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (prisma as any)[model].findFirst({ where });
  if (existing) throw new AppError(409, message);
}
