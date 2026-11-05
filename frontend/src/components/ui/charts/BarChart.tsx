import { useState, useCallback, type MouseEvent } from 'react';

import { chartColor, calcViewBoxWidth } from './chart-utils';
import { ChartTooltip } from './ChartTooltip';
import { useChartAnimation } from './useChartAnimation';

const MIN_WIDTH = 400;
const MIN_BAR_WIDTH = 4;
const MAX_BAR_WIDTH = 48;
const MIN_BAR_GAP = 2;
const FONT_SIZE = 9;
/** About what one character of a label takes, in the chart's units */
const CHAR_WIDTH = 5;
const MAX_LABEL = 14;

const labelText = (label: string) =>
  label.length > MAX_LABEL ? label.slice(0, MAX_LABEL - 1) + '..' : label;

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
export function BarChart({ data, height = 180, showValues = true, className }: BarChartProps) {
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
  const paddingTop = showValues ? 14 : 6;
  // Enough bars widen the chart, so that each keeps MIN_BAR_WIDTH and a gap
  const width = Math.max(
    MIN_WIDTH,
    calcViewBoxWidth(data.length, MIN_BAR_WIDTH, MIN_BAR_GAP, paddingLeft, paddingRight),
  );
  const chartW = width - paddingLeft - paddingRight;
  const slot = chartW / data.length;
  const barWidth = Math.min(Math.max(slot * 0.7, MIN_BAR_WIDTH), MAX_BAR_WIDTH);
  const labelsFit = data.every((d) => labelText(d.label).length * CHAR_WIDTH <= slot);
  const paddingBottom = labelsFit ? 18 : 68;
  const chartH = height - paddingTop - paddingBottom;
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  // Past one label per FONT_SIZE of width they would overlap, so only every so many get one
  const labelEvery = Math.ceil(FONT_SIZE / slot);
  const valuesFit = slot >= FONT_SIZE * 2;

  const tickCount = 3;
  const yTicks = [
    ...new Set(
      Array.from({ length: tickCount + 1 }, (_, i) => Math.round((maxValue / tickCount) * i)),
    ),
  ];

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
                y={y + 3}
                textAnchor="end"
                className="fill-text-tertiary"
                fontSize={FONT_SIZE}
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
          const center = paddingLeft + slot * i + slot / 2;
          const x = center - barWidth / 2;
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
              {showValues && valuesFit && progress > 0.8 && (
                <text
                  x={center}
                  y={y - 3}
                  textAnchor="middle"
                  className="fill-text-secondary"
                  fontSize={FONT_SIZE}
                  style={{ opacity: dimmed ? 0.4 : 1, transition: 'opacity 150ms' }}
                >
                  {d.value}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text
                  x={center}
                  y={paddingTop + chartH + 12}
                  textAnchor={labelsFit ? 'middle' : 'end'}
                  className="fill-text-tertiary"
                  fontSize={FONT_SIZE}
                  transform={
                    labelsFit ? undefined : `rotate(-45, ${center}, ${paddingTop + chartH + 12})`
                  }
                >
                  {labelText(d.label)}
                </text>
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
