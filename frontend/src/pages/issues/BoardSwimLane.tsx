import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';

import type { SwimLane } from './board-utils';

/**
 *
 * @param root0
 * @param root0.lane
 * @param root0.children
 * @param root0.defaultOpen
 */
/**
 *
 * @param root0
 * @param root0.lane
 * @param root0.children
 * @param root0.defaultOpen
 */
export function BoardSwimLaneSection({
  lane,
  children,
  defaultOpen,
}: {
  lane: SwimLane;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);

  if (!lane.label) return <>{children}</>;

  return (
    <div className="mb-2">
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1 px-1 hover:text-text w-full justify-start"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {lane.label}
        <span className="text-text-tertiary font-normal ml-1">({lane.issues.length})</span>
      </Button>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}
