import { useState, useCallback, useRef, type MouseEvent } from 'react';

import { chartColor } from './chart-utils';
import { ChartTooltip } from './ChartTooltip';
import { useChartAnimation } from './useChartAnimation';

interface LineSeries {
  label: string;
  data: { x: string | number; y: number }[];
  color?: string;
}

interface LineChartProps {
  series: LineSeries[];
  area?: boolean;
  showDots?: boolean;
  height?: number;
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.series
 * @param root0.area
 * @param root0.showDots
 * @param root0.height
 * @param root0.className
 */
export function LineChart({
  series,
  area = false,
  showDots = true,
  height = 140,
  className,
}: LineChartProps) {
  const progress = useChartAnimation();
  const [hoveredX, setHoveredX] = useState<number | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });

      // Find nearest x index
      if (series.length === 0 || series[0].data.length === 0) return;
      const relX = (e.clientX - rect.left) / rect.width;
      const count = series[0].data.length;
      const idx = Math.round(relX * (count - 1));
      setHoveredX(Math.max(0, Math.min(count - 1, idx)));
    },
    [series],
  );

  if (series.length === 0 || series[0].data.length === 0) {
    return <p className="text-sm text-text-secondary">No data available.</p>;
  }

  const paddingLeft = 32;
  const paddingRight = 8;
  const paddingTop = 8;
  const paddingBottom = 16;
  const width = 500;
  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  const allValues = series.flatMap((s) => s.data.map((d) => d.y));
  const maxY = Math.max(...allValues, 1);
  const minY = Math.min(...allValues, 0);
  const rangeY = maxY - minY || 1;
  const pointCount = series[0].data.length;

  function xPos(i: number) {
    return paddingLeft + (i / Math.max(pointCount - 1, 1)) * chartW;
  }

  function yPos(v: number) {
    return paddingTop + chartH - ((v - minY) / rangeY) * chartH;
  }

  // Y-axis ticks
  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round(minY + (rangeY / tickCount) * i),
  );

  // X-axis labels (show ~5)
  const xLabels = series[0].data;
  const labelStep = Math.max(1, Math.floor(pointCount / 5));

  return (
    <div
      ref={containerRef}
      className={`relative ${className ?? ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredX(null)}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid */}
        {yTicks.map((tick) => {
          const y = yPos(tick);
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
                fontSize={5}
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* X labels */}
        {xLabels.map((d, i) => {
          if (i % labelStep !== 0 && i !== pointCount - 1) return null;
          const label = String(d.x);
          return (
            <text
              key={i}
              x={xPos(i)}
              y={height - 2}
              textAnchor="middle"
              className="fill-text-tertiary"
              fontSize={5}
            >
              {label.length > 8 ? label.slice(label.length - 5) : label}
            </text>
          );
        })}

        {/* Crosshair on hover */}
        {hoveredX !== null && (
          <line
            x1={xPos(hoveredX)}
            y1={paddingTop}
            x2={xPos(hoveredX)}
            y2={paddingTop + chartH}
            className="stroke-border"
            strokeWidth={1}
          />
        )}

        {/* Series */}
        {series.map((s, si) => {
          const color = s.color ?? chartColor(si);

          // Build path up to progress
          const visibleCount = Math.max(1, Math.ceil(pointCount * progress));
          const points = s.data.slice(0, visibleCount).map((d, i) => ({
            x: xPos(i),
            y: yPos(d.y),
          }));

          const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

          const areaPath = area
            ? linePath +
              ` L ${points[points.length - 1].x} ${paddingTop + chartH} L ${points[0].x} ${paddingTop + chartH} Z`
            : '';

          return (
            <g key={si}>
              {area && <path d={areaPath} style={{ fill: color, opacity: 0.15 }} />}
              <path
                d={linePath}
                fill="none"
                style={{ stroke: color }}
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
              {/* Dots on hover */}
              {showDots && hoveredX !== null && hoveredX < visibleCount && (
                <circle
                  cx={xPos(hoveredX)}
                  cy={yPos(s.data[hoveredX].y)}
                  r={3}
                  style={{ fill: color, stroke: 'var(--color-surface)', strokeWidth: 1.5 }}
                />
              )}
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
        visible={hoveredX !== null}
        x={mouse.x}
        y={mouse.y}
        content={
          hoveredX !== null && (
            <div>
              <div className="font-medium mb-1">{String(series[0].data[hoveredX].x)}</div>
              {series.map((s, si) => (
                <div key={si} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: s.color ?? chartColor(si) }}
                  />
                  <span className="text-text-secondary">{s.label}:</span>
                  <span>{s.data[hoveredX].y}</span>
                </div>
              ))}
            </div>
          )
        }
      />
    </div>
  );
}
