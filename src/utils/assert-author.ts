import { AppError } from '../middleware/errorHandler';

/**
 * Assert that the given userId matches the author field on a record.
 * Throws 403 if not. Accepts either 'authorId' or 'userId' field names.
 * @param record
 * @param record.authorId
 * @param record.userId
 * @param userId
 * @param action
 */
export function assertAuthor(
  record: { authorId?: string; userId?: string },
  userId: string,
  action: 'edit' | 'delete' = 'edit',
): void {
  const recordUserId = record.authorId ?? record.userId;
  if (recordUserId !== userId) {
    throw new AppError(403, `You can only ${action} your own comments`);
  }
}
