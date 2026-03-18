import { Avatar } from '@/components/ui/Avatar';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/utils';

/**
 * Cursor color palette for collaboration presence.
 * Each connected user gets a distinct color.
 */
export const COLLAB_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

export interface PresenceUser {
  clientId: number;
  name: string;
  color: string;
}

interface PresenceIndicatorsProps {
  users: PresenceUser[];
  className?: string;
}

/**
 * Show small avatar circles for each connected collaborator.
 * Displays a colored ring matching their cursor color.
 * @param root0
 * @param root0.users
 * @param root0.className
 */
export function PresenceIndicators({ users, className }: PresenceIndicatorsProps) {
  if (users.length === 0) return null;

  return (
    <div className={cn('flex items-center -space-x-1.5', className)}>
      {users.map((user) => (
        <Tooltip key={user.clientId} content={user.name} side="bottom">
          <div
            className="rounded-full ring-2 ring-surface"
            style={{ boxShadow: `0 0 0 2px ${user.color}` }}
          >
            <Avatar name={user.name} size="xs" />
          </div>
        </Tooltip>
      ))}
      {users.length > 0 && (
        <span className="ml-3 text-xs text-text-tertiary">
          {users.length} {users.length === 1 ? 'editor' : 'editors'}
        </span>
      )}
    </div>
  );
}
