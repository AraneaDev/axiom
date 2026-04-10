import { useState, useCallback, type MouseEvent } from 'react';

import { CHART_SEQ_COLORS } from './chart-utils';
import { ChartTooltip } from './ChartTooltip';
import { useChartAnimation } from './useChartAnimation';

interface GaugeChartProps {
  value: number;
  label?: string;
  color?: string;
  size?: number;
  arc?: 180 | 270;
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.value
 * @param root0.label
 * @param root0.color
 * @param root0.size
 * @param root0.arc
 * @param root0.className
 */
export function GaugeChart({
  value,
  label,
  color,
  size = 120,
  arc = 270,
  className,
}: GaugeChartProps) {
  const progress = useChartAnimation();
  const [showTooltip, setShowTooltip] = useState(false);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const clamped = Math.max(0, Math.min(100, value));
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const strokeW = 8;

  // Determine gauge color from sequential palette based on value
  const fillColor =
    color ??
    CHART_SEQ_COLORS[
      Math.min(CHART_SEQ_COLORS.length - 1, Math.floor((clamped / 100) * CHART_SEQ_COLORS.length))
    ];

  // Arc geometry
  const startAngle = arc === 180 ? 180 : 135;
  const totalArc = arc;
  const endAngle = startAngle + totalArc;
  const valueAngle = startAngle + (clamped / 100) * totalArc * progress;

  function polarToXY(angle: number) {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arcPath(from: number, to: number) {
    const s = polarToXY(from);
    const e = polarToXY(to);
    const sweep = to - from;
    const large = sweep > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  }

  const bgPath = arcPath(startAngle, endAngle);
  const valuePath = clamped > 0 && progress > 0 ? arcPath(startAngle, valueAngle) : '';

  return (
    <div
      className={`relative inline-block ${className ?? ''}`}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {/* Background track */}
        <path
          d={bgPath}
          fill="none"
          className="stroke-surface-tertiary"
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
        {/* Value arc */}
        {valuePath && (
          <path
            d={valuePath}
            fill="none"
            style={{ stroke: fillColor }}
            strokeWidth={strokeW}
            strokeLinecap="round"
          />
        )}
        {/* Center text */}
        <text
          x={cx}
          y={arc === 180 ? cy - 2 : cy + 4}
          textAnchor="middle"
          className="fill-text"
          fontSize={size / 4.5}
          fontWeight={700}
        >
          {Math.round(clamped * progress)}%
        </text>
        {label && (
          <text
            x={cx}
            y={arc === 180 ? cy + size / 7 : cy + size / 4.5}
            textAnchor="middle"
            className="fill-text-secondary"
            fontSize={size / 10}
          >
            {label}
          </text>
        )}
      </svg>

      <ChartTooltip
        visible={showTooltip}
        x={mouse.x}
        y={mouse.y}
        content={
          <div>
            {label && <div className="font-medium">{label}</div>}
            <div className="text-text-secondary">{clamped}%</div>
          </div>
        }
      />
    </div>
  );
}
