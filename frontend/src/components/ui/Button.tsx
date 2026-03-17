import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const variants = {
  primary: 'bg-primary text-text-inverse hover:bg-primary-hover shadow-sm hover:shadow-md active:scale-[0.98]',
  secondary: 'bg-surface-tertiary text-text border border-border hover:bg-surface-secondary hover:border-border-focus/30',
  danger: 'bg-danger text-text-inverse hover:opacity-90 shadow-sm active:scale-[0.98]',
  ghost: 'text-text-secondary hover:text-text hover:bg-surface-tertiary',
  outline: 'border border-border text-text-secondary hover:text-text hover:border-primary hover:bg-primary-light',
};

const sizes = {
  xs: 'px-2 py-1 text-xs gap-1',
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-sm gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center font-medium rounded-md transition-all duration-150',
        'focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1',
        variants[variant],
        sizes[size],
        disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
        className,
      )}
      disabled={disabled}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
