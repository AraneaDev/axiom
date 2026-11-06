import { forwardRef } from 'react';
import { Link, type LinkProps } from 'react-router';

import { buttonClasses, type ButtonSize, type ButtonVariant } from '@/components/ui/button-styles';
import { cn } from '@/lib/utils';

interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * A react-router Link styled like a Button. Use it for navigation so middle-click and
 * "open in new tab" work; never nest a Button inside a Link.
 * @param props - Link props plus variant and size, same as Button.
 * @param props.variant - Visual style. Defaults to primary.
 * @param props.size - Size. Defaults to md.
 */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ className, variant = 'primary', size = 'md', children, ...props }, ref) => (
    <Link ref={ref} className={cn(buttonClasses(variant, size), className)} {...props}>
      {children}
    </Link>
  ),
);
ButtonLink.displayName = 'ButtonLink';
