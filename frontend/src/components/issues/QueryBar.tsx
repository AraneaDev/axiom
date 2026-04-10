import { Code, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface QueryBarProps {
  value: string;
  onChange: (query: string) => void;
  error?: { message: string; position: number } | null;
}

/**
 *
 * @param root0
 * @param root0.value
 * @param root0.onChange
 * @param root0.error
 */
export function QueryBar({ value, onChange, error }: QueryBarProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-1.5',
        'border-border',
        focused && 'border-primary ring-1 ring-primary',
        error && 'border-danger',
      )}
    >
      <Code className="h-4 w-4 shrink-0 text-text-tertiary" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="type:bug priority:high OR storyPoints > 5"
        className="flex-1 bg-transparent text-sm text-text placeholder:text-text-tertiary outline-none"
      />
      {value && (
        <Button variant="ghost" size="sm" title="Clear query" onClick={() => onChange('')}>
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
      {error && <span className="text-xs text-danger">{error.message}</span>}
    </div>
  );
}
