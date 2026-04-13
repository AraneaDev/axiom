import { useState, useCallback, type MouseEvent } from 'react';

import { chartColor, calcViewBoxWidth } from './chart-utils';
import { ChartTooltip } from './ChartTooltip';
import { useChartAnimation } from './useChartAnimation';

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
export function BarChart({ data, height = 60, showValues = true, className }: BarChartProps) {
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

  const paddingLeft = 28;
  const paddingRight = 8;
  const paddingTop = showValues ? 12 : 6;
  const paddingBottom = 30;
  const barGap = 4;
  const barWidth = Math.max(4, Math.min(16, 200 / data.length));
  const width = Math.max(
    400,
    calcViewBoxWidth(data.length, barWidth, barGap, paddingLeft, paddingRight),
  );
  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  const tickCount = 3;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round((maxValue / tickCount) * i),
  );

  return (
    <div
      className={`relative ${className ?? ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHovered(null)}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
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
                y={y + 2}
                textAnchor="end"
                className="fill-text-tertiary"
                fontSize={5}
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((d, i) => {
          const fullH = (d.value / maxValue) * chartH;
          const barH = fullH * progress;
          const x = paddingLeft + barGap + i * (barWidth + barGap);
          const y = paddingTop + chartH - barH;
          const isHovered = hovered === i;
          const dimmed = hovered !== null && !isHovered;

          return (
            <g key={i} onMouseEnter={() => setHovered(i)} style={{ cursor: 'pointer' }}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx={2}
                style={{
                  fill: d.color ?? chartColor(i),
                  opacity: dimmed ? 0.4 : 1,
                  transition: 'opacity 150ms, height 300ms ease-in-out, y 300ms ease-in-out',
                }}
              />
              {showValues && progress > 0.8 && (
                <text
                  x={x + barWidth / 2}
                  y={y - 2}
                  textAnchor="middle"
                  className="fill-text-secondary"
                  fontSize={5}
                  style={{ opacity: dimmed ? 0.4 : 1, transition: 'opacity 150ms' }}
                >
                  {d.value}
                </text>
              )}
              <text
                x={x + barWidth / 2}
                y={paddingTop + chartH + 5}
                textAnchor="end"
                className="fill-text-tertiary"
                fontSize={5}
                transform={`rotate(-45, ${x + barWidth / 2}, ${paddingTop + chartH + 5})`}
              >
                {d.label.length > 14 ? d.label.slice(0, 13) + '..' : d.label}
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

      <ChartTooltip
        visible={hovered !== null}
        x={mouse.x}
        y={mouse.y}
        content={
          hovered !== null && (
            <div>
              <div className="font-medium">{data[hovered].label}</div>
              <div className="text-text-secondary">{data[hovered].value}</div>
            </div>
          )
        }
      />
    </div>
  );
}
