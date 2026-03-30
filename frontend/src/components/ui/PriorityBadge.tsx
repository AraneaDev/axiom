import { PRIORITY_COLORS, PRIORITY_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';

type Priority = keyof typeof PRIORITY_COLORS;

interface PriorityBadgeProps {
  priority: string;
  /** 'full' shows label, 'short' shows first character */
  display?: 'full' | 'short';
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.priority
 * @param root0.display
 * @param root0.className
 */
export function PriorityBadge({ priority, display = 'full', className }: PriorityBadgeProps) {
  const colors = PRIORITY_COLORS[priority as Priority] ?? '';
  const label =
    display === 'short' ? priority[0] : (PRIORITY_LABELS[priority as Priority] ?? priority);

  return (
    <span className={cn('text-xs px-1.5 py-0.5 rounded-full', colors, className)}>{label}</span>
  );
}
