import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  success?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, success, id, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        className={cn(
          'w-full rounded-md border bg-surface px-3 py-2 text-sm transition-all duration-150',
          'placeholder:text-text-tertiary',
          'focus:border-border-focus focus:ring-2 focus:ring-primary/15 focus:outline-none focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          error
            ? 'border-danger focus:border-danger focus:ring-danger/15'
            : success
              ? 'border-success focus:border-success focus:ring-success/15'
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
