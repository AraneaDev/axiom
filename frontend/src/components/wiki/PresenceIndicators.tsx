import { Avatar } from '@/components/ui/Avatar';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/utils';

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
