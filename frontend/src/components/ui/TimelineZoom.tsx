import { ZoomIn } from 'lucide-react';

import { cn } from '@/lib/utils';

export type ZoomLevel = 'weeks' | 'months' | 'quarters';

interface TimelineZoomProps {
  value: ZoomLevel;
  onChange: (level: ZoomLevel) => void;
}

const LEVELS: { value: ZoomLevel; label: string }[] = [
  { value: 'weeks', label: 'Weeks' },
  { value: 'months', label: 'Months' },
  { value: 'quarters', label: 'Quarters' },
];

/**
 * Segmented control for selecting timeline zoom level.
 * @param props - Component props
 * @param props.value - Currently active zoom level.
 * @param props.onChange - Callback when the user selects a different level.
 */
export function TimelineZoom({ value, onChange }: TimelineZoomProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-secondary p-0.5">
      <ZoomIn className="h-3.5 w-3.5 text-text-tertiary ml-1 mr-0.5 shrink-0" />
      {LEVELS.map((level) => {
        const active = level.value === value;
        return (
          <button
            key={level.value}
            type="button"
            onClick={() => onChange(level.value)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded transition-all duration-150',
              active ? 'bg-surface text-text shadow-sm' : 'text-text-secondary hover:text-text',
            )}
            title={`Zoom: ${level.label}`}
          >
            {level.label}
          </button>
        );
      })}
    </div>
  );
}
