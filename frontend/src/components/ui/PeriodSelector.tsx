import { ChevronDown } from 'lucide-react';

import type { Period } from '@/api/analytics.api';
import { cn } from '@/lib/utils';

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'quarter', label: 'This quarter' },
];

interface PeriodSelectorProps {
  value: Period;
  onChange: (period: Period) => void;
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.value
 * @param root0.onChange
 * @param root0.className
 */
export function PeriodSelector({ value, onChange, className }: PeriodSelectorProps) {
  return (
    <div className={cn('relative inline-block', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Period)}
        className="appearance-none rounded-md border border-border bg-surface px-3 py-1.5 pr-8 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {PERIOD_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
    </div>
  );
}
