import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: 'sm' | 'md';
  label?: string;
  hint?: string;
  error?: string;
}

const sizes = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
};

/**
 * Reusable checkbox component with design token styling.
 * Supports optional label, hint, and error text matching the Input/Textarea pattern.
 * Uses forwardRef for DOM access and supports all native input[checkbox] attributes.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, size = 'sm', label, hint, error, id, ...props }, ref) => {
    const input = (
      <input
        ref={ref}
        type="checkbox"
        id={id}
        className={cn(
          'rounded border-border accent-primary cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1',
          sizes[size],
          props.disabled && 'opacity-40 cursor-not-allowed',
          !label && className,
        )}
        {...props}
      />
    );

    if (!label && !hint && !error) return input;

    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <div className="flex items-start gap-2">
          <div className="pt-0.5">{input}</div>
          {label && (
            <label
              htmlFor={id}
              className={cn(
                'text-sm font-medium text-text cursor-pointer',
                props.disabled && 'opacity-40 cursor-not-allowed',
              )}
            >
              {label}
            </label>
          )}
        </div>
        {error && <p className="text-xs text-danger ml-[calc(0.5rem+0.875rem)]">{error}</p>}
        {hint && !error && (
          <p className="text-xs text-text-tertiary ml-[calc(0.5rem+0.875rem)]">{hint}</p>
        )}
      </div>
    );
  },
);
Checkbox.displayName = 'Checkbox';
