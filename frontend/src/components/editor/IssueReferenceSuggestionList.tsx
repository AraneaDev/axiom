import { CircleAlert } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

import { Badge } from '@/components/ui/Badge';

export interface IssueReferenceItem {
  id: string;
  number: number;
  title: string;
  key: string;
  type: string;
  status?: string;
}

interface IssueReferenceSuggestionListProps {
  items: IssueReferenceItem[];
  command: (item: IssueReferenceItem) => void;
}

export interface IssueReferenceSuggestionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const IssueReferenceSuggestionList = forwardRef<
  IssueReferenceSuggestionListRef,
  IssueReferenceSuggestionListProps
>(({ items, command }, ref) => {
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
    <div className="bg-surface-elevated border border-border rounded-lg shadow-lg overflow-hidden min-w-[260px] max-w-[400px]">
      {items.map((item, idx) => (
        <button
          key={item.id}
          onClick={() => command(item)}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-tertiary transition-colors ${
            idx === selectedIndex ? 'bg-surface-tertiary' : ''
          }`}
        >
          <CircleAlert className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
          <span className="font-medium text-primary shrink-0">{item.key}</span>
          <span className="text-text truncate">{item.title}</span>
          {item.status && (
            <Badge variant="outline" className="ml-auto shrink-0 text-xs">
              {item.status}
            </Badge>
          )}
        </button>
      ))}
    </div>
  );
});

IssueReferenceSuggestionList.displayName = 'IssueReferenceSuggestionList';
export default IssueReferenceSuggestionList;
