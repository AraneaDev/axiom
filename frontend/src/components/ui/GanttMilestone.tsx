interface GanttMilestoneProps {
  x: number;
  y: number;
  color: string;
  label: string;
  onClick?: () => void;
}

/**
 * Diamond marker for issues that have only a dueDate (no date range).
 * @param props - Component props
 * @param props.x - Horizontal pixel offset.
 * @param props.y - Vertical pixel offset.
 * @param props.color - CSS variable color string.
 * @param props.label - Tooltip text shown on hover.
 * @param props.onClick - Click handler.
 */
export function GanttMilestone({ x, y, color, label, onClick }: GanttMilestoneProps) {
  return (
    <div
      className="absolute cursor-pointer hover:scale-125 transition-transform duration-100"
      style={{
        left: x - 6,
        top: y + 8,
        width: 12,
        height: 12,
        backgroundColor: color,
        transform: 'rotate(45deg)',
        borderRadius: 2,
      }}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    />
  );
}
