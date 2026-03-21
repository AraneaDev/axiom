import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: 'sm' | 'md';
}

const sizes = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
};

/**
 * Reusable checkbox component with design token styling.
 * Uses forwardRef for DOM access and supports all native input[checkbox] attributes.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, size = 'sm', ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'rounded border-border accent-primary cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1',
        sizes[size],
        props.disabled && 'opacity-40 cursor-not-allowed',
        className,
      )}
      {...props}
    />
  ),
);
Checkbox.displayName = 'Checkbox';
