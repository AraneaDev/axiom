import { forwardRef, isValidElement, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { buttonClasses, type ButtonSize, type ButtonVariant } from '@/components/ui/button-styles';
import { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
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
        className={cn(buttonClasses(variant, size, disabled), className)}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
