interface DependencyArrowProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  isViolation: boolean;
  isSelected?: boolean;
  onClick?: () => void;
}

/**
 * SVG path arrow drawn between two Gantt bars representing a dependency link.
 * Uses right-angle routing: horizontal from source, vertical connector, horizontal to target.
 * @param props.fromX - X coordinate of the source bar's right edge.
 * @param root0
 * @param root0.fromX
 * @param props.fromY - Y coordinate (center) of the source bar.
 * @param root0.fromY
 * @param props.toX - X coordinate of the target bar's left edge.
 * @param root0.toX
 * @param props.toY - Y coordinate (center) of the target bar.
 * @param root0.toY
 * @param props.isViolation - True when the blocked issue starts before the blocker ends.
 * @param root0.isViolation
 * @param props.isSelected - Whether the arrow is currently selected for deletion.
 * @param root0.isSelected
 * @param props.onClick - Click handler for selecting/deselecting.
 * @param root0.onClick
 */
export function DependencyArrow({
  fromX,
  fromY,
  toX,
  toY,
  isViolation,
  isSelected,
  onClick,
}: DependencyArrowProps) {
  const color = isViolation
    ? 'var(--color-danger)'
    : isSelected
      ? 'var(--color-primary)'
      : 'var(--color-text-tertiary)';

  // Right-angle path: go right from source, then down/up, then right to target
  const midX = fromX + (toX - fromX) / 2;
  const d = [
    `M ${fromX} ${fromY}`,
    `L ${midX} ${fromY}`,
    `L ${midX} ${toY}`,
    `L ${toX} ${toY}`,
  ].join(' ');

  // Arrowhead at the target end
  const arrowSize = 6;
  const arrowD =
    toX >= midX
      ? `M ${toX - arrowSize} ${toY - arrowSize / 2} L ${toX} ${toY} L ${toX - arrowSize} ${toY + arrowSize / 2}`
      : `M ${toX + arrowSize} ${toY - arrowSize / 2} L ${toX} ${toY} L ${toX + arrowSize} ${toY + arrowSize / 2}`;

  return (
    <g className="cursor-pointer" onClick={onClick}>
      {/* Wider invisible hit area for easier clicking */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={10} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={isSelected ? 2 : 1.5}
        strokeDasharray={isViolation ? '4 2' : undefined}
      />
      <path d={arrowD} fill="none" stroke={color} strokeWidth={isSelected ? 2 : 1.5} />
    </g>
  );
}
