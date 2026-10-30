interface DragHandleProps {
  cx: number;
  cy: number;
  onDragStart: (e: React.PointerEvent<SVGCircleElement>) => void;
}

/**
 * Small circle on bar edges for creating dependency links.
 * Visible only on hover of the parent group element.
 * @param props - Component props
 * @param props.cx - Circle center X coordinate.
 * @param props.cy - Circle center Y coordinate.
 * @param props.onDragStart - Pointer-down handler to initiate link creation.
 */
export function DragHandle({ cx, cy, onDragStart }: DragHandleProps) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill="var(--color-primary)"
      stroke="var(--color-surface)"
      strokeWidth={1.5}
      className="opacity-0 group-hover:opacity-100 transition-opacity duration-100 cursor-crosshair"
      onPointerDown={onDragStart}
    />
  );
}
