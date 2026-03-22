import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  success?: boolean;
}

/**
 * Text input component with label, hint, error, and success states.
 * Follows the shared UI component pattern with forwardRef and cn() merging.
 * @param props - Input props extending native input attributes.
 * @param props.label - Optional label displayed above the input.
 * @param props.error - Error message displayed below the input; applies danger styling.
 * @param props.hint - Hint text displayed below the input when no error is present.
 * @param props.success - Applies success border styling when true.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, success, id, ...props }, ref) => (
    <div className="flex flex-col gap-2">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        className={cn(
          'w-full rounded-md border bg-surface px-3 py-2 h-9 text-sm transition-all duration-150',
          'placeholder:text-text-tertiary',
          'focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:outline-none focus-visible:shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          error
            ? 'border-danger focus-visible:border-danger focus-visible:ring-danger/30'
            : success
              ? 'border-success focus-visible:border-success focus-visible:ring-success/30'
              : 'border-border',
          className,
        )}
        {...props}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      {hint && !error && <p className="text-xs text-text-tertiary">{hint}</p>}
    </div>
  ),
);
Input.displayName = 'Input';
