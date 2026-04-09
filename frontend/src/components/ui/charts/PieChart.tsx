interface PieChartProps {
  data: { label: string; value: number; color: string }[];
  size?: number;
  donut?: boolean;
  className?: string;
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 *
 * @param root0
 * @param root0.data
 * @param root0.size
 * @param root0.donut
 * @param root0.className
 */
export function PieChart({ data, size = 200, donut = true, className }: PieChartProps) {
  if (data.length === 0) {
    return <p className="text-sm text-text-secondary">No data available.</p>;
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) {
    return <p className="text-sm text-text-secondary">No data available.</p>;
  }

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 4;
  const innerR = donut ? outerR * 0.55 : 0;

  const legendWidth = 160;
  const viewWidth = size + legendWidth;

  // Build slices
  const slices: {
    path: string;
    color: string;
    label: string;
    value: number;
  }[] = [];

  let currentAngle = 0;
  for (const d of data) {
    const sliceAngle = (d.value / total) * 360;
    if (sliceAngle === 0) continue;

    // For a full circle (single item)
    if (sliceAngle >= 359.99) {
      const path = donut
        ? `M ${cx} ${cy - outerR} A ${outerR} ${outerR} 0 1 1 ${cx - 0.01} ${cy - outerR} Z M ${cx} ${cy - innerR} A ${innerR} ${innerR} 0 1 0 ${cx - 0.01} ${cy - innerR} Z`
        : `M ${cx} ${cy} m -${outerR} 0 a ${outerR} ${outerR} 0 1 1 ${outerR * 2} 0 a ${outerR} ${outerR} 0 1 1 -${outerR * 2} 0 Z`;
      slices.push({ path, color: d.color, label: d.label, value: d.value });
    } else {
      const startAngle = currentAngle;
      const endAngle = currentAngle + sliceAngle;
      const outerStart = polarToCartesian(cx, cy, outerR, endAngle);
      const outerEnd = polarToCartesian(cx, cy, outerR, startAngle);
      const largeArc = sliceAngle > 180 ? 1 : 0;

      let path: string;
      if (donut) {
        const innerStart = polarToCartesian(cx, cy, innerR, startAngle);
        const innerEnd = polarToCartesian(cx, cy, innerR, endAngle);
        path = [
          `M ${outerStart.x} ${outerStart.y}`,
          `A ${outerR} ${outerR} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
          `L ${innerStart.x} ${innerStart.y}`,
          `A ${innerR} ${innerR} 0 ${largeArc} 1 ${innerEnd.x} ${innerEnd.y}`,
          'Z',
        ].join(' ');
      } else {
        path = [
          `M ${cx} ${cy}`,
          `L ${outerEnd.x} ${outerEnd.y}`,
          `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerStart.x} ${outerStart.y}`,
          'Z',
        ].join(' ');
      }
      slices.push({ path, color: d.color, label: d.label, value: d.value });
    }
    currentAngle += sliceAngle;
  }

  return (
    <svg
      viewBox={`0 0 ${viewWidth} ${Math.max(size, data.length * 22 + 10)}`}
      className={`w-full h-auto ${className ?? ''}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Slices */}
      {slices.map((s, i) => (
        <path key={i} d={s.path} style={{ fill: s.color }} />
      ))}

      {/* Legend */}
      {data.map((d, i) => {
        const ly = 10 + i * 22;
        const lx = size + 16;
        const pct = ((d.value / total) * 100).toFixed(1);

        return (
          <g key={i}>
            <rect x={lx} y={ly} width={10} height={10} rx={2} style={{ fill: d.color }} />
            <text x={lx + 16} y={ly + 9} className="fill-text-secondary" fontSize={9}>
              {d.label}
            </text>
            <text
              x={lx + legendWidth - 10}
              y={ly + 9}
              textAnchor="end"
              className="fill-text-tertiary"
              fontSize={9}
            >
              {d.value} ({pct}%)
            </text>
          </g>
        );
      })}
    </svg>
  );
}
