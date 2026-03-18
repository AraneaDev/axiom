import { cn, initials } from '@/lib/utils';

interface AvatarProps {
  name: string;
  src?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
};

// Generate a consistent color from name using design tokens
function nameToColor(name: string): string {
  const colors = [
    'bg-primary',
    'bg-accent',
    'bg-success',
    'bg-warning',
    'bg-danger',
    'bg-primary',
    'bg-accent',
    'bg-success',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

/**
 *
 * @param root0
 * @param root0.name
 * @param root0.src
 * @param root0.size
 * @param root0.className
 */
export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('rounded-full object-cover ring-1 ring-border', sizes[size], className)}
      />
    );
  }
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full text-white font-semibold shadow-sm',
        nameToColor(name),
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </div>
  );
}
