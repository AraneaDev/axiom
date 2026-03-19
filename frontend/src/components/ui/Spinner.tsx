import { cn } from '@/lib/utils';

const spinnerSizes = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-10 w-10',
};

/**
 * Animated loading spinner rendered as a spinning border circle.
 * @param props - Spinner configuration.
 * @param props.size - Spinner dimensions: sm, md, lg. Defaults to md.
 * @param props.className - Additional CSS classes.
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
 * Full-page centered loading indicator using a large Spinner.
 * Takes up at least 50vh to center vertically within the viewport.
 */
export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh] animate-fade-in">
      <Spinner size="lg" />
    </div>
  );
}
