import { type ReactNode, useRef, useLayoutEffect } from 'react';

interface ChartTooltipProps {
  visible: boolean;
  x: number;
  y: number;
  content: ReactNode;
}

/**
 * Floating tooltip for chart hover states.
 * Positioned relative to the chart container (parent must be position: relative).
 * @param root0
 * @param root0.visible
 * @param root0.x
 * @param root0.y
 * @param root0.content
 */
export function ChartTooltip({ visible, x, y, content }: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!visible || !ref.current) return;
    const el = ref.current;
    const parent = el.offsetParent as HTMLElement | null;
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    const elW = el.offsetWidth;
    const elH = el.offsetHeight;

    let dx = 12;
    let dy = -8;

    // Flip left if tooltip would overflow right edge
    if (x + dx + elW > parentRect.width) dx = -elW - 12;
    // Flip down if tooltip would overflow top
    if (y + dy - elH < 0) dy = 16;

    el.style.left = `${x + dx}px`;
    el.style.top = `${y + dy}px`;
  }, [visible, x, y]);

  if (!visible) return null;

  return (
    <div
      ref={ref}
      className="absolute z-20 pointer-events-none rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 text-xs shadow-lg transition-opacity duration-150"
      style={{
        left: x + 12,
        top: y - 8,
        opacity: visible ? 1 : 0,
      }}
    >
      {content}
    </div>
  );
}
