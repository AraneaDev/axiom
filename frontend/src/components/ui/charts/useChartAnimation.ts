import { useEffect, useState } from 'react';

/**
 * Returns a 0-to-1 progress value that animates on mount.
 * Used by chart components to drive entry animations.
 * @param duration - animation duration in ms (default 500)
 */
export function useChartAnimation(duration = 500): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let rafId: number;

    function tick(now: number) {
      const elapsed = now - start;
      // The first frame's timestamp can be earlier than the effect that asked for it
      const t = Math.max(0, Math.min(1, elapsed / duration));
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(eased);
      if (t < 1) rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [duration]);

  return progress;
}
