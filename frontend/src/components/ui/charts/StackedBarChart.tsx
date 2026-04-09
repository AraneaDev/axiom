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

  const barHeight = 18;
  const barGap = 6;
  const paddingLeft = 96;
  const paddingRight = 44;
  const paddingTop = 24;
  const paddingBottom = 8;
  const legendHeight = 20;
  const width = 400;
  const computedHeight =
    height ?? paddingTop + legendHeight + data.length * (barHeight + barGap) + paddingBottom;
  const chartW = width - paddingLeft - paddingRight;

  const maxTotal = Math.max(...data.map((d) => d.segments.reduce((sum, s) => sum + s.value, 0)), 1);

  return (
    <svg
      viewBox={`0 0 ${width} ${computedHeight}`}
      className={`w-full h-auto max-h-80 ${className ?? ''}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Legend */}
      {segmentLabels.map((label, i) => {
        const lx = paddingLeft + i * 110;
        return (
          <g key={i}>
            <rect x={lx} y={8} width={10} height={10} rx={2} style={{ fill: segmentColors[i] }} />
            <text x={lx + 14} y={17} className="fill-text-secondary" fontSize={9}>
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
              fontSize={9}
            >
              {d.label}
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
                  rx={isFirst || isLast ? 3 : 0}
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
              fontSize={9}
            >
              {total}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
