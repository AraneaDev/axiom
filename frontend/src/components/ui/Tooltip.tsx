import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

interface TooltipProps {
  content: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}

const ARROW_SIZE = 8; // border-4 = 4px each side
const MARGIN = 8; // minimum distance from viewport edge

const arrowClasses = {
  top: 'border-t-surface-inverse border-x-transparent border-b-transparent border-4',
  bottom: 'border-b-surface-inverse border-x-transparent border-t-transparent border-4',
  left: 'border-l-surface-inverse border-y-transparent border-r-transparent border-4',
  right: 'border-r-surface-inverse border-y-transparent border-l-transparent border-4',
};

/**
 * Hover-triggered tooltip rendered via portal so it is never clipped by
 * overflow containers.  Positions itself relative to the viewport using
 * the trigger's bounding rect and clamps to stay fully visible.
 * @param props - Tooltip configuration.
 * @param props.content - Text to display inside the tooltip.
 * @param props.side - Tooltip placement relative to the trigger: top, bottom, left, right. Defaults to top.
 * @param props.children - The element that triggers the tooltip on hover.
 */
export function Tooltip({ content, side = 'top', children }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [arrowOffset, setArrowOffset] = useState<number | null>(null);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const tr = trigger.getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = 0;
    let left = 0;

    switch (side) {
      case 'top':
        top = tr.top - th - ARROW_SIZE;
        left = tr.left + tr.width / 2 - tw / 2;
        break;
      case 'bottom':
        top = tr.bottom + ARROW_SIZE;
        left = tr.left + tr.width / 2 - tw / 2;
        break;
      case 'left':
        top = tr.top + tr.height / 2 - th / 2;
        left = tr.left - tw - ARROW_SIZE;
        break;
      case 'right':
        top = tr.top + tr.height / 2 - th / 2;
        left = tr.right + ARROW_SIZE;
        break;
    }

    // Clamp horizontally
    const origLeft = left;
    left = Math.max(MARGIN, Math.min(left, vw - tw - MARGIN));

    // Clamp vertically
    top = Math.max(MARGIN, Math.min(top, vh - th - MARGIN));

    // Arrow offset: how much we shifted from the centered position
    if (side === 'top' || side === 'bottom') {
      const shift = origLeft - left;
      setArrowOffset(tw / 2 + shift);
    } else {
      setArrowOffset(null);
    }

    setPos({ top: top + window.scrollY, left: left + window.scrollX });
  }, [side]);

  useLayoutEffect(() => {
    if (visible) reposition();
  }, [visible, reposition]);

  const handleMouseEnter = useCallback(() => setVisible(true), []);
  const handleMouseLeave = useCallback(() => setVisible(false), []);

  const arrowStyle =
    arrowOffset != null
      ? ({ position: 'absolute', left: `${arrowOffset}px`, transform: 'translateX(-50%)' } as const)
      : undefined;

  const arrowPositionClass =
    side === 'top'
      ? 'top-full'
      : side === 'bottom'
        ? 'bottom-full'
        : side === 'left'
          ? 'left-full top-1/2 -translate-y-1/2'
          : 'right-full top-1/2 -translate-y-1/2';

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </span>
      {visible &&
        createPortal(
          <span
            ref={tooltipRef}
            className="pointer-events-none fixed z-[9999] animate-fade-in"
            style={{ top: pos.top, left: pos.left, position: 'fixed' }}
          >
            <span className="whitespace-nowrap max-w-xs rounded-md bg-surface-inverse px-2.5 py-1.5 text-xs text-text-inverse shadow-lg">
              {content}
            </span>
            <span
              className={cn('absolute', arrowClasses[side], arrowPositionClass)}
              style={arrowStyle}
            />
          </span>,
          document.body,
        )}
    </>
  );
}
