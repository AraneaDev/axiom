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

// Generate a consistent color from name
function nameToColor(name: string): string {
  const colors = [
    'from-indigo-400 to-purple-500',
    'from-blue-400 to-cyan-500',
    'from-emerald-400 to-teal-500',
    'from-orange-400 to-rose-500',
    'from-violet-400 to-fuchsia-500',
    'from-sky-400 to-indigo-500',
    'from-pink-400 to-rose-500',
    'from-teal-400 to-emerald-500',
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
        'flex items-center justify-center rounded-full bg-gradient-to-br text-white font-semibold shadow-sm',
        nameToColor(name),
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </div>
  );
}
