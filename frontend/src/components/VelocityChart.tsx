import { BarChart3 } from 'lucide-react';

import type { VelocityDataPoint } from '@/lib/types';

/**
 * SVG bar chart showing completed story points per sprint.
 * Follows the InsightsTab SVG chart pattern.
 * @param root0
 * @param root0.data
 */
export function VelocityChart({ data }: { data: VelocityDataPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-text-secondary text-sm">
        No completed sprints yet. Velocity will appear after completing sprints.
      </div>
    );
  }

  const maxPoints = Math.max(...data.map((d) => d.completedPoints), 1);
  const avgPoints =
    data.length > 0
      ? Math.round(data.reduce((sum, d) => sum + d.completedPoints, 0) / data.length)
      : 0;

  const width = 400;
  const height = 180;
  const paddingX = 40;
  const paddingTop = 20;
  const paddingBottom = 30;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingTop - paddingBottom;

  const barGap = 8;
  const barWidth = Math.max((chartW - barGap * (data.length - 1)) / data.length, 12);

  const yTicks = [0, Math.round(maxPoints / 2), maxPoints];
  const avgY = paddingTop + chartH - (avgPoints / maxPoints) * chartH;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-text">Velocity</span>
        <span className="text-xs text-text-secondary ml-auto">Avg: {avgPoints} pts/sprint</span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid lines and Y-axis labels */}
        {yTicks.map((tick) => {
          const y = paddingTop + chartH - (tick / maxPoints) * chartH;
          return (
            <g key={tick}>
              <line
                x1={paddingX}
                y1={y}
                x2={width - paddingX}
                y2={y}
                className="stroke-border"
                strokeWidth="1"
                strokeDasharray="4 2"
              />
              <text
                x={paddingX - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-text-tertiary text-[9px]"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Average line */}
        {avgPoints > 0 && (
          <line
            x1={paddingX}
            y1={avgY}
            x2={width - paddingX}
            y2={avgY}
            className="stroke-primary"
            strokeWidth="1"
            strokeDasharray="6 3"
            opacity="0.5"
          />
        )}

        {/* Bars */}
        {data.map((d, i) => {
          const x = paddingX + i * (barWidth + barGap);
          const barH = (d.completedPoints / maxPoints) * chartH;
          return (
            <g key={d.sprintId}>
              <rect
                x={x}
                y={paddingTop + chartH - barH}
                width={barWidth}
                height={Math.max(barH, 1)}
                className="fill-primary"
                opacity="0.8"
                rx="2"
              />
              {/* Point label above bar */}
              <text
                x={x + barWidth / 2}
                y={paddingTop + chartH - barH - 4}
                textAnchor="middle"
                className="fill-text-secondary text-[8px]"
              >
                {d.completedPoints}
              </text>
              {/* Sprint name below */}
              <text
                x={x + barWidth / 2}
                y={height - 6}
                textAnchor="middle"
                className="fill-text-tertiary text-[8px]"
              >
                {d.sprintName.length > 8 ? d.sprintName.slice(0, 7) + '..' : d.sprintName}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
