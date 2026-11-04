import { Bot } from 'lucide-react';

import { cn } from '@/lib/utils';

interface ViaLabelProps {
  /** Name of the API token that made the change; renders nothing when empty */
  via: string | null | undefined;
  className?: string;
}

/**
 * Marks an activity or audit actor as acting through an API token: "(via Claude Code)".
 * @param props - The token name and optional className
 * @param props.via - Name of the API token, null for a browser session
 * @param props.className - Extra classes
 */
export function ViaLabel({ via, className }: ViaLabelProps) {
  if (!via) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-text-tertiary', className)}>
      <Bot className="h-3 w-3" aria-hidden="true" />
      (via {via})
    </span>
  );
}
