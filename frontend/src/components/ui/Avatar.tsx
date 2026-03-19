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
 * User avatar component displaying an image or initials fallback.
 * Shows the user's image when src is provided, otherwise renders
 * computed initials on a colored background.
 * @param props - Avatar configuration.
 * @param props.name - User's display name; used for alt text and initials fallback.
 * @param props.src - Optional image URL for the avatar.
 * @param props.size - Avatar dimensions: xs, sm, md, lg, xl. Defaults to md.
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
