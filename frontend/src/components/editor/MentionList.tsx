import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';

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

  useEffect(() => setSelectedIndex(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') { setSelectedIndex(i => (i - 1 + items.length) % items.length); return true; }
      if (event.key === 'ArrowDown') { setSelectedIndex(i => (i + 1) % items.length); return true; }
      if (event.key === 'Enter') { if (items[selectedIndex]) command(items[selectedIndex]); return true; }
      return false;
    },
  }));

  if (!items.length) return null;

  return (
    <div className="bg-surface-elevated border border-border rounded-lg shadow-lg overflow-hidden min-w-[180px]">
      {items.map((item, idx) => (
        <button
          key={item.id}
          onClick={() => command(item)}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-secondary transition-colors ${idx === selectedIndex ? 'bg-surface-secondary' : ''}`}
        >
          <Avatar name={item.displayName} size="sm" />
          <span className="font-medium">{item.displayName}</span>
          <span className="text-text-tertiary text-xs">@{item.username}</span>
        </button>
      ))}
    </div>
  );
});

MentionList.displayName = 'MentionList';
export default MentionList;
