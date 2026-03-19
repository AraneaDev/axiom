import { prisma } from '../config/database';
import { createNotification } from '../modules/notifications/notifications.service';

import { parseMentions } from './mentions';

/**
 * Parse `@mentions` from text, look up users by username, and create notifications for each (skipping the author).
 * Intended for fire-and-forget usage -- callers should `.catch()` to avoid unhandled rejections.
 * @param text - The text to scan for `@mentions`
 * @param authorId - The ID of the user who authored the text (excluded from notifications)
 * @param resourceUrl - Optional URL to the resource for the notification link
 */
export async function notifyMentions(
  text: string,
  authorId: string,
  resourceUrl?: string,
): Promise<void> {
  const usernames = parseMentions(text);
  if (usernames.length === 0) return;

  const [users, author] = await Promise.all([
    prisma.user.findMany({
      where: { username: { in: usernames } },
      select: { id: true, username: true },
    }),
    prisma.user.findUnique({
      where: { id: authorId },
      select: { username: true },
    }),
  ]);

  const authorName = author?.username ?? 'someone';

  for (const user of users) {
    const message =
      user.id === authorId
        ? 'You mentioned yourself (reminder)'
        : `You were mentioned by @${authorName}`;
    await createNotification(user.id, 'mention', message, undefined, resourceUrl);
  }
}
