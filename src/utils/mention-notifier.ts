import { prisma } from '../config/database';
import { createNotification } from '../modules/notifications/notifications.service';

import { parseMentions } from './mentions';

/**
 * Parse `@mentions` from text, look up user IDs by username,
 * and create a notification for each mentioned user (skipping the author).
 * Fire-and-forget -- callers should `.catch(() => {})`.
 * @param text
 * @param authorId
 * @param resourceUrl
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
    if (user.id === authorId) continue;
    await createNotification(
      user.id,
      'mention',
      `You were mentioned by @${authorName}`,
      undefined,
      resourceUrl,
    );
  }
}
