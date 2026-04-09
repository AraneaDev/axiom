interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  showValues?: boolean;
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.data
 * @param root0.height
 * @param root0.showValues
 * @param root0.className
 */
export function BarChart({ data, height = 150, showValues = true, className }: BarChartProps) {
  if (data.length === 0) {
    return <p className="text-sm text-text-secondary">No data available.</p>;
  }

  const barWidth = 28;
  const barGap = 6;
  const paddingLeft = 32;
  const paddingRight = 8;
  const paddingTop = showValues ? 16 : 8;
  const paddingBottom = 20;
  const width = paddingLeft + paddingRight + data.length * (barWidth + barGap) + barGap;
  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  const maxValue = Math.max(...data.map((d) => d.value), 1);

  const tickCount = 3;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round((maxValue / tickCount) * i),
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`w-full h-auto ${className ?? ''}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Grid lines */}
      {yTicks.map((tick) => {
        const y = paddingTop + chartH - (tick / maxValue) * chartH;
        return (
          <g key={tick}>
            <line
              x1={paddingLeft}
              y1={y}
              x2={paddingLeft + chartW}
              y2={y}
              className="stroke-border"
              strokeDasharray="4 3"
              strokeWidth={0.5}
            />
            <text
              x={paddingLeft - 4}
              y={y + 3}
              textAnchor="end"
              className="fill-text-tertiary"
              fontSize={7}
            >
              {tick}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const barH = (d.value / maxValue) * chartH;
        const x = paddingLeft + barGap + i * (barWidth + barGap);
        const y = paddingTop + chartH - barH;

        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barH}
              rx={2}
              style={{ fill: d.color ?? 'var(--color-accent)' }}
            />
            {showValues && (
              <text
                x={x + barWidth / 2}
                y={y - 3}
                textAnchor="middle"
                className="fill-text-secondary"
                fontSize={7}
              >
                {d.value}
              </text>
            )}
            {/* X-axis label */}
            <text
              x={x + barWidth / 2}
              y={paddingTop + chartH + 12}
              textAnchor="middle"
              className="fill-text-tertiary"
              fontSize={7}
            >
              {d.label.length > 10 ? d.label.slice(0, 9) + '..' : d.label}
            </text>
          </g>
        );
      })}

      {/* Baseline */}
      <line
        x1={paddingLeft}
        y1={paddingTop + chartH}
        x2={paddingLeft + chartW}
        y2={paddingTop + chartH}
        className="stroke-border"
        strokeWidth={0.5}
      />
    </svg>
  );
}
