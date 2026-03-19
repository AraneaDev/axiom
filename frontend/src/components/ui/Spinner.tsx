import { cn } from '@/lib/utils';

const spinnerSizes = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-10 w-10',
};

/**
 *
 * @param root0
 * @param root0.className
 * @param root0.size
 */
export function Spinner({
  className,
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <div
      className={cn(
        'animate-spin rounded-full border-2 border-primary border-t-transparent',
        spinnerSizes[size],
        className,
      )}
    />
  );
}

/**
 *
 */
export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh] animate-fade-in">
      <Spinner size="lg" />
    </div>
  );
}
