import { useState, useCallback, type MouseEvent } from 'react';

import { chartColor } from './chart-utils';
import { ChartTooltip } from './ChartTooltip';
import { useChartAnimation } from './useChartAnimation';

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
  const progress = useChartAnimation();
  const [hovered, setHovered] = useState<number | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

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
    <div
      className={`relative ${className ?? ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHovered(null)}
    >
      <svg
        viewBox={`0 0 ${width} ${computedHeight}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        {data.map((d, i) => {
          const fullW = (d.value / maxValue) * chartW;
          const barW = fullW * progress;
          const y = paddingTop + i * (barHeight + barGap);
          const isHovered = hovered === i;
          const dimmed = hovered !== null && !isHovered;

          return (
            <g key={i} onMouseEnter={() => setHovered(i)} style={{ cursor: 'pointer' }}>
              {/* Label */}
              <text
                x={paddingLeft - 8}
                y={y + barHeight / 2 + 4}
                textAnchor="end"
                className="fill-text-secondary"
                fontSize={6}
                style={{ opacity: dimmed ? 0.5 : 1, transition: 'opacity 150ms' }}
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
                style={{
                  fill: d.color ?? chartColor(i),
                  opacity: dimmed ? 0.4 : 1,
                  transition: 'opacity 150ms, width 300ms ease-in-out',
                }}
              />

              {/* Value */}
              {showValues && progress > 0.8 && (
                <text
                  x={paddingLeft + barW + 6}
                  y={y + barHeight / 2 + 4}
                  textAnchor="start"
                  className="fill-text-secondary"
                  fontSize={6}
                  style={{ opacity: dimmed ? 0.4 : 1, transition: 'opacity 150ms' }}
                >
                  {format(d.value)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <ChartTooltip
        visible={hovered !== null}
        x={mouse.x}
        y={mouse.y}
        content={
          hovered !== null && (
            <div>
              <div className="font-medium">{data[hovered].label}</div>
              <div className="text-text-secondary">{format(data[hovered].value)}</div>
            </div>
          )
        }
      />
    </div>
  );
}
