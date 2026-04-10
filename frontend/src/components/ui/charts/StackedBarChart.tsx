import { useState, useCallback, type MouseEvent } from 'react';

import { ChartTooltip } from './ChartTooltip';
import { useChartAnimation } from './useChartAnimation';

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
  const paddingRight = 30;
  const paddingTop = 14;
  const paddingBottom = 3;
  const legendHeight = 12;
  const width = 600;
  const computedHeight =
    height ?? paddingTop + legendHeight + data.length * (barHeight + barGap) + paddingBottom;
  const chartW = width - paddingLeft - paddingRight;
  const maxTotal = Math.max(...data.map((d) => d.segments.reduce((sum, s) => sum + s.value, 0)), 1);

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

              {/* Stacked segments */}
              {d.segments.map((seg, j) => {
                const segW = (seg.value / maxTotal) * chartW * progress;
                const segX = xOffset;
                xOffset += (seg.value / maxTotal) * chartW * progress;

                if (seg.value === 0) return null;

                const isFirst = j === 0 || d.segments.slice(0, j).every((s) => s.value === 0);
                const isLast =
                  j === d.segments.length - 1 ||
                  d.segments.slice(j + 1).every((s) => s.value === 0);

                return (
                  <rect
                    key={j}
                    x={segX}
                    y={y}
                    width={Math.max(segW, 1)}
                    height={barHeight}
                    rx={isFirst || isLast ? 2 : 0}
                    style={{
                      fill: seg.color,
                      opacity: dimmed ? 0.4 : 1,
                      transition: 'opacity 150ms, width 300ms ease-in-out, x 300ms ease-in-out',
                    }}
                  />
                );
              })}

              {/* Total */}
              {progress > 0.8 && (
                <text
                  x={paddingLeft + (total / maxTotal) * chartW * progress + 6}
                  y={y + barHeight / 2 + 4}
                  textAnchor="start"
                  className="fill-text-secondary"
                  fontSize={6}
                  style={{ opacity: dimmed ? 0.4 : 1, transition: 'opacity 150ms' }}
                >
                  {total}
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
              <div className="font-medium mb-1">{data[hovered].label}</div>
              {data[hovered].segments.map((seg, j) => (
                <div key={j} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-sm"
                    style={{ background: seg.color }}
                  />
                  <span className="text-text-secondary">{segmentLabels[j]}:</span>
                  <span>{seg.value}</span>
                </div>
              ))}
            </div>
          )
        }
      />
    </div>
  );
}
