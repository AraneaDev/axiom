import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface MentionItem {
  id: string;
  displayName: string;
  username: string;
}

interface MentionListProps {
  items: MentionItem[];
  command: (item: MentionItem) => void;
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const MentionList = forwardRef<MentionListRef, MentionListProps>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect -- reset index when items change */
  useEffect(() => setSelectedIndex(0), [items]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        if (items[selectedIndex]) command(items[selectedIndex]);
        return true;
      }
      return false;
    },
  }));

  if (!items.length) return null;

  return (
    <div className="bg-surface-elevated border border-border rounded-lg shadow-lg overflow-hidden min-w-[180px]">
      {items.map((item, idx) => (
        <Button
          key={item.id}
          variant="ghost"
          size="sm"
          onClick={() => command(item)}
          className={cn(
            'w-full justify-start rounded-none px-3 py-2',
            idx === selectedIndex ? 'bg-surface-secondary' : '',
          )}
        >
          <Avatar name={item.displayName} size="sm" />
          <span className="font-medium">{item.displayName}</span>
          <span className="text-text-tertiary text-xs">@{item.username}</span>
        </Button>
      ))}
    </div>
  );
});

MentionList.displayName = 'MentionList';
export default MentionList;
