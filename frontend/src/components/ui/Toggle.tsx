import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: 'sm' | 'md';
}

const sizes = {
  sm: { track: 'h-5 w-9', thumb: 'h-4 w-4', translate: 'translate-x-4' },
  md: { track: 'h-6 w-11', thumb: 'h-5 w-5', translate: 'translate-x-5' },
};

/**
 * Reusable toggle-switch component with design token styling.
 * Uses forwardRef and supports all native button attributes.
 */
export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(
  ({ checked, onChange, size = 'sm', className, disabled, ...props }, ref) => {
    const s = sizes[size];
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1',
          s.track,
          disabled
            ? 'opacity-40 cursor-not-allowed bg-surface-tertiary'
            : checked
              ? 'bg-primary'
              : 'bg-surface-tertiary',
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            'pointer-events-none inline-block rounded-full bg-surface shadow-sm ring-0 transition-transform',
            s.thumb,
            checked ? s.translate : 'translate-x-0',
          )}
        />
      </button>
    );
  },
);
Toggle.displayName = 'Toggle';
