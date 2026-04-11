import { Hash } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { TocEntry } from '@/lib/wiki-types';

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 *
 * @param root0
 * @param root0.entries
 */
export function TableOfContents({ entries }: { entries: TocEntry[] }) {
  if (!entries.length) return null;

  return (
    <nav className="space-y-1">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
        On this page
      </h3>
      {entries.map((entry, i) => (
        <Button
          key={`${entry.id}-${i}`}
          variant="ghost"
          size="xs"
          type="button"
          onClick={() => scrollTo(entry.id)}
          className={cn(
            'w-full justify-start text-text-tertiary hover:text-primary truncate',
            entry.level === 1 && 'font-medium text-text-secondary',
            entry.level === 2 && 'pl-3',
            entry.level === 3 && 'pl-6 text-xs',
          )}
        >
          <Hash className="h-3 w-3" /> {entry.text}
        </Button>
      ))}
    </nav>
  );
}
