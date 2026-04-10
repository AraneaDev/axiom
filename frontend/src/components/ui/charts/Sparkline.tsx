import { useChartAnimation } from './useChartAnimation';

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  fill?: boolean;
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.data
 * @param root0.color
 * @param root0.height
 * @param root0.width
 * @param root0.fill
 * @param root0.className
 */
export function Sparkline({
  data,
  color,
  height = 24,
  width = 80,
  fill = false,
  className,
}: SparklineProps) {
  const progress = useChartAnimation(300);

  if (data.length < 2) return null;

  const stroke = color ?? 'var(--color-chart-1)';
  const padding = 2;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;
  const minVal = Math.min(...data);
  const maxVal = Math.max(...data);
  const range = maxVal - minVal || 1;

  const visibleCount = Math.max(2, Math.ceil(data.length * progress));
  const points = data.slice(0, visibleCount).map((v, i) => ({
    x: padding + (i / (data.length - 1)) * chartW,
    y: padding + chartH - ((v - minVal) / range) * chartH,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = fill
    ? linePath +
      ` L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`
    : '';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className}>
      {fill && <path d={areaPath} style={{ fill: stroke, opacity: 0.15 }} />}
      <path
        d={linePath}
        fill="none"
        style={{ stroke }}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
