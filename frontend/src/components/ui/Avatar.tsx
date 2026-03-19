import { forwardRef, type HTMLAttributes } from 'react';

import { cn, initials } from '@/lib/utils';

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  src?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

const sizes = {
  xs: 'h-6 w-6 text-[9px]',
  sm: 'h-8 w-8 text-[10px]',
  md: 'h-10 w-10 text-xs',
  lg: 'h-12 w-12 text-sm',
  xl: 'h-16 w-16 text-base',
};

/**
 *
 * @param root0
 * @param root0.name
 * @param root0.src
 * @param root0.size
 * @param root0.className
 * @param ref
 */
export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  ({ name, src, size = 'md', className, ...props }, ref) => {
    if (src) {
      return (
        <img
          src={src}
          alt={name}
          className={cn('rounded-full object-cover ring-2 ring-surface', sizes[size], className)}
        />
      );
    }
    return (
      <div
        ref={ref}
        className={cn(
          'flex items-center justify-center rounded-full font-medium ring-2 ring-surface',
          'bg-primary-light text-primary',
          sizes[size],
          className,
        )}
        {...props}
      >
        {initials(name)}
      </div>
    );
  },
);
Avatar.displayName = 'Avatar';
