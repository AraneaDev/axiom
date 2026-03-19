import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

/**
 * Multi-line text input with label, hint, and error states.
 * Follows the same API pattern as the Input component.
 * @param props - Textarea props extending native textarea attributes.
 * @param props.label - Optional label displayed above the textarea.
 * @param props.error - Error message displayed below; applies danger styling.
 * @param props.hint - Hint text displayed when no error is present.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, id, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={id}
        className={cn(
          'w-full rounded-md border bg-surface px-3 py-2 text-sm transition-all duration-150',
          'placeholder:text-text-tertiary',
          'focus:border-border-focus focus:ring-2 focus:ring-primary/15 focus:outline-none',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          error ? 'border-danger focus:border-danger focus:ring-danger/15' : 'border-border',
          className,
        )}
        {...props}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      {hint && !error && <p className="text-xs text-text-tertiary">{hint}</p>}
    </div>
  ),
);
Textarea.displayName = 'Textarea';
