import { forwardRef, isValidElement, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

/**
 * Recursively check whether React children contain any visible text.
 * @param node
 */
function hasText(node: ReactNode): boolean {
  if (typeof node === 'string') return node.trim().length > 0;
  if (typeof node === 'number') return true;
  if (Array.isArray(node)) return node.some(hasText);
  if (isValidElement(node)) return hasText((node.props as { children?: ReactNode }).children);
  return false;
}

const variants = {
  primary:
    'bg-primary text-text-inverse hover:bg-primary-hover shadow-sm hover:shadow-md active:scale-[0.98]',
  secondary:
    'bg-surface-tertiary text-text border border-border hover:bg-surface-secondary hover:border-border-focus/30',
  danger: 'bg-danger text-text-inverse hover:opacity-90 shadow-sm active:scale-[0.98]',
  ghost: 'text-text-secondary hover:text-text hover:bg-surface-tertiary',
  outline:
    'border border-border text-text-secondary hover:text-text hover:border-primary hover:bg-primary-light',
};

const sizes = {
  xs: 'px-2 py-1 text-xs gap-1',
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 h-9 text-[13px] gap-2',
  lg: 'px-5 py-2.5 text-sm gap-2',
};

/**
 * Reusable button component with variant and size support.
 * Uses forwardRef for DOM access and supports all native button attributes.
 * @param props - Button props including variant, size, disabled, and children.
 * @param props.variant - Visual style: primary, secondary, danger, ghost, outline. Defaults to primary.
 * @param props.size - Button size: xs, sm, md, lg. Defaults to md.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', disabled, children, ...props }, ref) => {
    if (
      (import.meta as unknown as { env: { DEV: boolean } }).env.DEV &&
      !disabled &&
      !props['aria-label'] &&
      !props.title
    ) {
      if (!hasText(children)) {
        console.warn('Button: icon-only buttons should have aria-label or title prop');
      }
    }
    return (
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
      >
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
