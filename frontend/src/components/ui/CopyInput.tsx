import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface CopyInputProps {
  value: string;
  label?: string;
  className?: string;
}

/**
 * Read-only input with a copy-to-clipboard button.
 * Used for displaying URLs or tokens that users need to copy. A multi-line value, such as
 * a config file, shows in a read-only textarea instead, because an input drops line breaks.
 * @param root0
 * @param root0.value - The text to display and copy.
 * @param root0.label - Accessible label for the input.
 * @param root0.className - Additional CSS classes for the wrapper.
 */
export function CopyInput({ value, label, className }: CopyInputProps) {
  const [copied, setCopied] = useState(false);
  const multiLine = value.includes('\n');

  function handleCopy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={cn('flex gap-2', multiLine ? 'items-start' : 'items-center', className)}>
      {multiLine ? (
        <textarea
          readOnly
          value={value}
          aria-label={label}
          rows={value.split('\n').length}
          wrap="off"
          className="flex-1 min-w-0 text-xs font-mono bg-surface-secondary border border-border rounded px-2 py-1.5 text-text resize-none overflow-x-auto"
        />
      ) : (
        <input
          readOnly
          value={value}
          aria-label={label}
          className="flex-1 min-w-0 text-xs font-mono bg-surface-secondary border border-border rounded px-2 py-1.5 h-8 text-text"
        />
      )}
      <Button
        variant="ghost"
        size="xs"
        onClick={handleCopy}
        title={label ? `Copy ${label}` : 'Copy'}
        aria-label={label ? `Copy ${label}` : 'Copy'}
      >
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}
