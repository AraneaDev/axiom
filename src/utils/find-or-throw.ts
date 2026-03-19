import { AppError } from '../middleware/errorHandler';

/**
 * Await a nullable promise and throw a 404 AppError if the result is null/undefined.
 * @param promise - The promise to await (typically a Prisma findUnique/findFirst call)
 * @param message - The error message for the 404 AppError
 * @returns The non-null result
 * @throws {AppError} 404 if the result is null or undefined
 */
export async function findOrThrow<T>(promise: Promise<T | null>, message: string): Promise<T> {
  const result = await promise;
  if (!result) throw new AppError(404, message);
  return result;
}
