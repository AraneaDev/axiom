import { Palette } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

import { PRIORITY_LEGEND, TYPE_LEGEND } from './board-utils';

/**
 * @param root0
 * @param root0.cardColorBy
 * @param root0.onChangeCardColor
 */
export function BoardColorByMenu({
  cardColorBy,
  onChangeCardColor,
}: {
  cardColorBy: string | null;
  onChangeCardColor: (value: string | null) => void;
}) {
  const [showColorMenu, setShowColorMenu] = useState(false);

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setShowColorMenu((o) => !o)}
        className={cardColorBy ? 'border-primary text-primary' : ''}
      >
        <Palette className="h-4 w-4" /> Color by
      </Button>
      {showColorMenu && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-surface border border-border rounded-md shadow-md py-1 min-w-[140px] animate-slide-down">
          {[
            { value: null as string | null, label: 'None' },
            { value: 'priority', label: 'Priority' },
            { value: 'type', label: 'Type' },
          ].map((opt) => (
            <Button
              key={opt.value ?? 'none'}
              variant="ghost"
              size="sm"
              onClick={() => {
                onChangeCardColor(opt.value);
                setShowColorMenu(false);
              }}
              className={cn(
                'w-full justify-start rounded-none px-3 py-1.5',
                cardColorBy === opt.value && 'text-primary font-semibold',
              )}
            >
              <Palette className="h-3.5 w-3.5" />
              {opt.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @param root0
 * @param root0.cardColorBy
 */
export function BoardColorLegend({ cardColorBy }: { cardColorBy: string | null }) {
  if (!cardColorBy) return null;

  const legend = cardColorBy === 'priority' ? PRIORITY_LEGEND : TYPE_LEGEND;

  return (
    <div className="flex items-center gap-3 mb-2 px-1">
      <span className="text-xs text-text-secondary font-medium">Color by {cardColorBy}:</span>
      {legend.map((item) => (
        <div key={item.key} className="flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-xs text-text-secondary">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
