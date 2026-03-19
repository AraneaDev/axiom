import { AppError } from '../middleware/errorHandler';

/**
 * Await a nullable promise and throw a 404 AppError if the result is null/undefined.
 * @param promise
 * @param message
 */
export async function findOrThrow<T>(promise: Promise<T | null>, message: string): Promise<T> {
  const result = await promise;
  if (!result) throw new AppError(404, message);
  return result;
}
