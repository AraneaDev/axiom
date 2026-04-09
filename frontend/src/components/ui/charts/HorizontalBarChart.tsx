interface HorizontalBarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  showValues?: boolean;
  formatValue?: (v: number) => string;
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.data
 * @param root0.height
 * @param root0.showValues
 * @param root0.formatValue
 * @param root0.className
 */
export function HorizontalBarChart({
  data,
  height,
  showValues = true,
  formatValue,
  className,
}: HorizontalBarChartProps) {
  if (data.length === 0) {
    return <p className="text-sm text-text-secondary">No data available.</p>;
  }

  const barHeight = 10;
  const barGap = 3;
  const paddingLeft = 70;
  const paddingRight = 35;
  const paddingTop = 3;
  const paddingBottom = 3;
  const width = 600;
  const computedHeight = height ?? paddingTop + paddingBottom + data.length * (barHeight + barGap);
  const chartW = width - paddingLeft - paddingRight;

  const maxValue = Math.max(...data.map((d) => d.value), 1);

  const format = formatValue ?? ((v: number) => String(v));

  return (
    <svg
      viewBox={`0 0 ${width} ${computedHeight}`}
      className={`w-full h-auto ${className ?? ''}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {data.map((d, i) => {
        const barW = (d.value / maxValue) * chartW;
        const y = paddingTop + i * (barHeight + barGap);

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

            {/* Bar */}
            <rect
              x={paddingLeft}
              y={y}
              width={Math.max(barW, 2)}
              height={barHeight}
              rx={2}
              style={{ fill: d.color ?? 'var(--color-primary)' }}
            />

            {/* Value */}
            {showValues && (
              <text
                x={paddingLeft + barW + 6}
                y={y + barHeight / 2 + 4}
                textAnchor="start"
                className="fill-text-secondary"
                fontSize={6}
              >
                {format(d.value)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
