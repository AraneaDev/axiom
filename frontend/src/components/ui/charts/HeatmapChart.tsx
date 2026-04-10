import { useState, useCallback, type MouseEvent } from 'react';

import { seqColor } from './chart-utils';
import { ChartTooltip } from './ChartTooltip';
import { useChartAnimation } from './useChartAnimation';

interface HeatmapChartProps {
  data: { x: string; y: string; value: number }[];
  xLabels: string[];
  yLabels: string[];
  formatValue?: (v: number) => string;
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.data
 * @param root0.xLabels
 * @param root0.yLabels
 * @param root0.formatValue
 * @param root0.className
 */
export function HeatmapChart({
  data,
  xLabels,
  yLabels,
  formatValue,
  className,
}: HeatmapChartProps) {
  const progress = useChartAnimation();
  const [hovered, setHovered] = useState<{ x: string; y: string; value: number } | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  if (data.length === 0) {
    return <p className="text-sm text-text-secondary">No data available.</p>;
  }

  const format = formatValue ?? ((v: number) => String(v));
  const allValues = data.map((d) => d.value);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);

  const paddingLeft = 50;
  const paddingTop = 16;
  const cellSize = 14;
  const cellGap = 2;
  const cols = xLabels.length;
  const rows = yLabels.length;
  const width = paddingLeft + cols * (cellSize + cellGap) + 10;
  const height = paddingTop + rows * (cellSize + cellGap) + 10;

  // Index data for fast lookup
  const dataMap = new Map<string, number>();
  for (const d of data) {
    dataMap.set(`${d.x}|${d.y}`, d.value);
  }

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
        {/* X labels */}
        {xLabels.map((label, xi) => (
          <text
            key={xi}
            x={paddingLeft + xi * (cellSize + cellGap) + cellSize / 2}
            y={10}
            textAnchor="middle"
            className="fill-text-tertiary"
            fontSize={4.5}
          >
            {label.length > 6 ? label.slice(0, 5) + '..' : label}
          </text>
        ))}

        {/* Y labels + cells */}
        {yLabels.map((yLabel, yi) => (
          <g key={yi}>
            <text
              x={paddingLeft - 4}
              y={paddingTop + yi * (cellSize + cellGap) + cellSize / 2 + 3}
              textAnchor="end"
              className="fill-text-secondary"
              fontSize={5}
            >
              {yLabel.length > 10 ? yLabel.slice(0, 9) + '..' : yLabel}
            </text>

            {xLabels.map((xLabel, xi) => {
              const val = dataMap.get(`${xLabel}|${yLabel}`) ?? 0;
              const cellX = paddingLeft + xi * (cellSize + cellGap);
              const cellY = paddingTop + yi * (cellSize + cellGap);
              const isHovered = hovered?.x === xLabel && hovered?.y === yLabel;
              const staggerDelay = (yi * cols + xi) / (rows * cols);
              const cellOpacity = progress > staggerDelay ? 1 : 0;

              return (
                <rect
                  key={xi}
                  x={cellX}
                  y={cellY}
                  width={cellSize}
                  height={cellSize}
                  rx={2}
                  style={{
                    fill: seqColor(val, minVal, maxVal),
                    opacity: cellOpacity,
                    stroke: isHovered ? 'var(--color-text)' : 'transparent',
                    strokeWidth: isHovered ? 1 : 0,
                    transition: 'opacity 200ms, stroke 150ms',
                  }}
                  onMouseEnter={() => setHovered({ x: xLabel, y: yLabel, value: val })}
                />
              );
            })}
          </g>
        ))}
      </svg>

      <ChartTooltip
        visible={hovered !== null}
        x={mouse.x}
        y={mouse.y}
        content={
          hovered && (
            <div>
              <div className="font-medium">
                {hovered.y} / {hovered.x}
              </div>
              <div className="text-text-secondary">{format(hovered.value)}</div>
            </div>
          )
        }
      />
    </div>
  );
}
