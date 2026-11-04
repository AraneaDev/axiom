import { AppError } from '../middleware/errorHandler';

const MAX_LIMIT = 100;

export interface ListWindow {
  take: number;
  skip: number;
}

/**
 * Which part of a list was asked for. Without limit or offset, the whole list: a caller never gets
 * less than it asked for without being told.
 * @param limit - The limit as text, if given
 * @param offset - The offset as text, if given
 * @returns The window, or undefined for the whole list
 * @throws {AppError} 400 for a limit outside 1 to 100
 */
export function listWindow(
  limit: string | undefined,
  offset: string | undefined,
): ListWindow | undefined {
  if (!limit && !offset) return undefined;
  const take = limit ? parseInt(limit, 10) : MAX_LIMIT;
  if (take < 1 || take > MAX_LIMIT) {
    throw new AppError(400, `limit must be between 1 and ${MAX_LIMIT}`);
  }
  return { take, skip: offset ? parseInt(offset, 10) : 0 };
}

/**
 * The answer for a window of a list.
 * @param data - The rows of the window
 * @param total - All rows
 * @param window - The window
 */
export function pagedList<T>(data: T[], total: number, window: ListWindow) {
  return { data, total, limit: window.take, offset: window.skip };
}
