import { prisma } from '../../config/database';
import { broadcastToUser } from '../../realtime/broadcast';

/**
 * Create a notification and broadcast it to the user via WebSocket.
 * @param userId - The user to notify
 * @param type - Notification type (e.g., 'issue:assigned', 'pr:reviewed')
 * @param title - Notification title text
 * @param body - Optional notification body text
 * @param link - Optional link to the relevant resource
 * @returns The created notification record
 */
export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body?: string,
  link?: string,
) {
  const notification = await prisma.notification.create({
    data: { userId, type, title, body, link, read: false },
  });

  broadcastToUser(userId, {
    type: 'notification',
    userId,
    notificationId: notification.id,
  });

  return notification;
}

/**
 * List notifications for a user with optional unread filter and pagination.
 * @param userId - The user ID
 * @param opts - Optional filters for unreadOnly, limit, and offset
 * @param opts.unreadOnly
 * @param opts.limit
 * @param opts.offset
 * @returns Paginated notifications with total count
 */
export async function listNotifications(
  userId: string,
  opts?: { unreadOnly?: boolean; limit?: number; offset?: number },
) {
  const where: { userId: string; read?: boolean } = { userId };
  if (opts?.unreadOnly) where.read = false;

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts?.limit ?? 50,
      skip: opts?.offset ?? 0,
    }),
    prisma.notification.count({ where }),
  ]);

  return { notifications, total };
}

/**
 * Mark a single notification as read.
 * @param id - The notification ID
 * @param userId - The user ID (ownership check)
 * @returns Update result
 */
export async function markRead(id: string, userId: string) {
  return prisma.notification.updateMany({
    where: { id, userId },
    data: { read: true },
  });
}

/**
 * Mark all unread notifications as read for a user.
 * @param userId - The user ID
 * @returns Update result
 */
export async function markAllRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}

/**
 * Get unread notification count for a user.
 * @param userId - The user ID
 * @returns The count of unread notifications
 */
export async function getUnreadCount(userId: string) {
  return prisma.notification.count({
    where: { userId, read: false },
  });
}

// ─── Notification Preferences ──────────────────────────────

const DEFAULT_EVENT_TYPES = [
  'issue_assigned',
  'issue_commented',
  'pr_review_requested',
  'pr_merged',
  'mention',
] as const;

/**
 * Get all notification preferences for a user, filling in defaults for
 * any event types that don't have explicit preferences stored yet.
 * @param userId
 */
export async function getPreferences(userId: string) {
  const stored = await prisma.notificationPreference.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });

  const byEvent = new Map(stored.map((p) => [p.eventType, p]));

  return DEFAULT_EVENT_TYPES.map((eventType) => {
    const existing = byEvent.get(eventType);
    return {
      eventType,
      inApp: existing?.inApp ?? true,
      email: existing?.email ?? false,
    };
  });
}

/**
 * Upsert a single notification preference for a user.
 * @param userId
 * @param eventType
 * @param data
 * @param data.inApp
 * @param data.email
 */
export async function updatePreference(
  userId: string,
  eventType: string,
  data: { inApp?: boolean; email?: boolean },
) {
  return prisma.notificationPreference.upsert({
    where: { userId_eventType: { userId, eventType } },
    create: {
      userId,
      eventType,
      inApp: data.inApp ?? true,
      email: data.email ?? false,
    },
    update: {
      ...(data.inApp !== undefined && { inApp: data.inApp }),
      ...(data.email !== undefined && { email: data.email }),
    },
  });
}
