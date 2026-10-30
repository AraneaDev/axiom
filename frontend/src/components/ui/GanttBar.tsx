import { useCallback, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface GanttBarProps {
  x: number;
  width: number;
  y: number;
  height?: number;
  color: string;
  label: string;
  progress?: number;
  onClick?: () => void;
  onResizeStart?: (deltaX: number) => void;
  onResizeEnd?: (deltaX: number) => void;
  onMove?: (deltaX: number) => void;
}

type DragMode = 'move' | 'resize-left' | 'resize-right' | null;

/**
 * Draggable and resizable bar representing a single issue on the Gantt chart.
 * @param props - Component props
 * @param props.x - Pixel offset from the left edge.
 * @param props.width - Bar width in pixels.
 * @param props.y - Pixel offset from the top.
 * @param props.height - Bar height in pixels. Defaults to 28.
 * @param props.color - CSS variable color string for the bar fill.
 * @param props.label - Truncated text shown inside the bar.
 * @param props.progress - Optional 0-100 progress for epics (filled portion).
 * @param props.onClick - Click handler.
 * @param props.onResizeStart - Called with deltaX when left edge is dragged.
 * @param props.onResizeEnd - Called with deltaX when right edge is dragged.
 * @param props.onMove - Called with deltaX when the full bar is dragged.
 */
export function GanttBar({
  x,
  width,
  y,
  height = 28,
  color,
  label,
  progress,
  onClick,
  onResizeStart,
  onResizeEnd,
  onMove,
}: GanttBarProps) {
  const dragMode = useRef<DragMode>(null);
  const startX = useRef(0);
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = useCallback((e: React.PointerEvent, mode: DragMode) => {
    e.stopPropagation();
    e.preventDefault();
    dragMode.current = mode;
    startX.current = e.clientX;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragMode.current) return;
      const deltaX = e.clientX - startX.current;
      if (Math.abs(deltaX) < 2) return;

      if (dragMode.current === 'move' && onMove) {
        onMove(deltaX);
      } else if (dragMode.current === 'resize-left' && onResizeStart) {
        onResizeStart(deltaX);
      } else if (dragMode.current === 'resize-right' && onResizeEnd) {
        onResizeEnd(deltaX);
      }
      startX.current = e.clientX;
    },
    [onMove, onResizeStart, onResizeEnd],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (dragMode.current) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      dragMode.current = null;
      setDragging(false);
    }
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging && onClick) {
        e.stopPropagation();
        onClick();
      }
    },
    [dragging, onClick],
  );

  const clampedProgress = progress != null ? Math.min(100, Math.max(0, progress)) : null;

  return (
    <div
      className={cn(
        'group absolute flex items-center rounded cursor-pointer select-none',
        'hover:brightness-110 transition-[filter] duration-100',
      )}
      style={{
        left: x,
        top: y,
        width: Math.max(width, 8),
        height,
        backgroundColor: color,
      }}
      title={label}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Progress fill for epics */}
      {clampedProgress != null && (
        <div
          className="absolute inset-0 rounded opacity-30"
          style={{
            width: `${clampedProgress}%`,
            backgroundColor: 'var(--color-text)',
          }}
        />
      )}

      {/* Left resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-l"
        style={{ backgroundColor: 'rgba(0,0,0,0.2)' }}
        onPointerDown={(e) => handlePointerDown(e, 'resize-left')}
      />

      {/* Label */}
      <span className="relative z-[1] px-2 text-xs font-medium text-white truncate leading-none">
        {label}
      </span>

      {/* Right resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-r"
        style={{ backgroundColor: 'rgba(0,0,0,0.2)' }}
        onPointerDown={(e) => handlePointerDown(e, 'resize-right')}
      />

      {/* Full-bar move capture (center area) */}
      <div
        className="absolute inset-x-1.5 inset-y-0 cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => handlePointerDown(e, 'move')}
      />
    </div>
  );
}
