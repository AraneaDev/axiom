interface StackedBarChartProps {
  data: { label: string; segments: { value: number; color: string }[] }[];
  segmentLabels: string[];
  segmentColors: string[];
  height?: number;
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.data
 * @param root0.segmentLabels
 * @param root0.segmentColors
 * @param root0.height
 * @param root0.className
 */
export function StackedBarChart({
  data,
  segmentLabels,
  segmentColors,
  height,
  className,
}: StackedBarChartProps) {
  if (data.length === 0) {
    return <p className="text-sm text-text-secondary">No data available.</p>;
  }

  const barHeight = 12;
  const barGap = 4;
  const paddingLeft = 80;
  const paddingRight = 36;
  const paddingTop = 18;
  const paddingBottom = 4;
  const legendHeight = 14;
  const width = 400;
  const computedHeight =
    height ?? paddingTop + legendHeight + data.length * (barHeight + barGap) + paddingBottom;
  const chartW = width - paddingLeft - paddingRight;

  const maxTotal = Math.max(...data.map((d) => d.segments.reduce((sum, s) => sum + s.value, 0)), 1);

  return (
    <svg
      viewBox={`0 0 ${width} ${computedHeight}`}
      className={`w-full h-auto ${className ?? ''}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Legend */}
      {segmentLabels.map((label, i) => {
        const lx = paddingLeft + i * 90;
        return (
          <g key={i}>
            <rect x={lx} y={4} width={7} height={7} rx={1} style={{ fill: segmentColors[i] }} />
            <text x={lx + 10} y={11} className="fill-text-secondary" fontSize={6}>
              {label}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const total = d.segments.reduce((sum, s) => sum + s.value, 0);
        const y = paddingTop + legendHeight + i * (barHeight + barGap);
        let xOffset = paddingLeft;

        return (
          <g key={i}>
            {/* Label */}
            <text
              x={paddingLeft - 8}
              y={y + barHeight / 2 + 4}
              textAnchor="end"
              className="fill-text-secondary"
              fontSize={6}
            >
              {d.label.length > 14 ? d.label.slice(0, 13) + '..' : d.label}
            </text>

            {/* Stacked segments */}
            {d.segments.map((seg, j) => {
              const segW = (seg.value / maxTotal) * chartW;
              const segX = xOffset;
              xOffset += segW;

              if (seg.value === 0) return null;

              const isFirst = j === 0 || d.segments.slice(0, j).every((s) => s.value === 0);
              const isLast =
                j === d.segments.length - 1 || d.segments.slice(j + 1).every((s) => s.value === 0);

              return (
                <rect
                  key={j}
                  x={segX}
                  y={y}
                  width={Math.max(segW, 1)}
                  height={barHeight}
                  rx={isFirst || isLast ? 2 : 0}
                  style={{ fill: seg.color }}
                />
              );
            })}

            {/* Total */}
            <text
              x={paddingLeft + (total / maxTotal) * chartW + 6}
              y={y + barHeight / 2 + 4}
              textAnchor="start"
              className="fill-text-secondary"
              fontSize={6}
            >
              {total}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
