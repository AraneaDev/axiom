import { TrendingDown } from 'lucide-react';

import type { Sprint } from '@/lib/types';

/**
 * SVG line chart showing remaining story points over a sprint's duration.
 * Renders an ideal burndown line and actual remaining points per day.
 * @param root0
 * @param root0.sprint
 */
export function BurndownChart({ sprint }: { sprint: Sprint }) {
  const start = new Date(sprint.startDate);
  const end = new Date(sprint.endDate);
  const totalDays = Math.max(Math.round((end.getTime() - start.getTime()) / 86400000), 1);
  const totalPoints = sprint.issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);

  if (totalPoints === 0) {
    return (
      <div className="text-center py-6 text-text-secondary text-sm">
        No story points assigned. Add estimates to see the burndown.
      </div>
    );
  }

  // Calculate actual burndown: for each day, compute remaining points
  // Issues in "done" columns are considered complete on or before the sprint date
  const donePoints = sprint.issues
    .filter((i) =>
      i.column && 'isDone' in i.column
        ? (i.column as { isDone?: boolean }).isDone
        : i.column?.name?.toLowerCase().includes('done'),
    )
    .reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);

  const now = new Date();
  const elapsedDays = Math.min(
    Math.max(Math.round((now.getTime() - start.getTime()) / 86400000), 0),
    totalDays,
  );

  // Build actual data points: linear approximation from total to remaining
  // In a real system this would come from daily snapshots
  const remaining = totalPoints - donePoints;
  const actualPoints: { day: number; points: number }[] = [];
  for (let d = 0; d <= Math.min(elapsedDays, totalDays); d++) {
    if (d === 0) {
      actualPoints.push({ day: 0, points: totalPoints });
    } else if (d === elapsedDays) {
      actualPoints.push({ day: d, points: remaining });
    } else {
      // Linear interpolation between start and current
      const progress = d / elapsedDays;
      const interpolated = Math.round(totalPoints - (totalPoints - remaining) * progress);
      actualPoints.push({ day: d, points: interpolated });
    }
  }

  const width = 400;
  const height = 180;
  const paddingX = 40;
  const paddingTop = 20;
  const paddingBottom = 30;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingTop - paddingBottom;

  const scaleX = (day: number) => paddingX + (day / totalDays) * chartW;
  const scaleY = (pts: number) => paddingTop + chartH - (pts / totalPoints) * chartH;

  // Ideal burndown line (straight from totalPoints to 0)
  const idealStart = `${scaleX(0)},${scaleY(totalPoints)}`;
  const idealEnd = `${scaleX(totalDays)},${scaleY(0)}`;

  // Actual burndown polyline
  const actualPolyline = actualPoints.map((p) => `${scaleX(p.day)},${scaleY(p.points)}`).join(' ');

  // Area under actual line
  const actualArea =
    actualPoints.length > 1
      ? `M${scaleX(actualPoints[0].day)},${scaleY(0)} ` +
        actualPoints.map((p) => `L${scaleX(p.day)},${scaleY(p.points)}`).join(' ') +
        ` L${scaleX(actualPoints[actualPoints.length - 1].day)},${scaleY(0)} Z`
      : '';

  const yTicks = [0, Math.round(totalPoints / 2), totalPoints];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <TrendingDown className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-text">Burndown</span>
        <span className="text-xs text-text-secondary ml-auto">
          {remaining} / {totalPoints} pts remaining
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid lines and Y-axis labels */}
        {yTicks.map((tick) => {
          const y = scaleY(tick);
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

        {/* X-axis day labels */}
        <text
          x={scaleX(0)}
          y={height - 6}
          textAnchor="middle"
          className="fill-text-tertiary text-[8px]"
        >
          Day 0
        </text>
        <text
          x={scaleX(totalDays)}
          y={height - 6}
          textAnchor="middle"
          className="fill-text-tertiary text-[8px]"
        >
          Day {totalDays}
        </text>
        {totalDays > 4 && (
          <text
            x={scaleX(Math.round(totalDays / 2))}
            y={height - 6}
            textAnchor="middle"
            className="fill-text-tertiary text-[8px]"
          >
            Day {Math.round(totalDays / 2)}
          </text>
        )}

        {/* Ideal burndown line (dashed) */}
        <line
          x1={parseFloat(idealStart.split(',')[0])}
          y1={parseFloat(idealStart.split(',')[1])}
          x2={parseFloat(idealEnd.split(',')[0])}
          y2={parseFloat(idealEnd.split(',')[1])}
          className="stroke-text-tertiary"
          strokeWidth="1.5"
          strokeDasharray="6 3"
          opacity="0.5"
        />

        {/* Actual burndown area */}
        {actualArea && <path d={actualArea} className="fill-primary" opacity="0.1" />}

        {/* Actual burndown line */}
        {actualPoints.length > 1 && (
          <polyline
            points={actualPolyline}
            fill="none"
            className="stroke-primary"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        )}

        {/* Current point dot */}
        {actualPoints.length > 0 && (
          <circle
            cx={scaleX(actualPoints[actualPoints.length - 1].day)}
            cy={scaleY(actualPoints[actualPoints.length - 1].points)}
            r="3"
            className="fill-primary"
          />
        )}
      </svg>

      {/* Legend */}
      <div className="flex gap-4 mt-2 text-[10px] text-text-tertiary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-0 border-t-2 border-dashed border-text-tertiary" />
          Ideal
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-0 border-t-2 border-primary" />
          Actual
        </span>
      </div>
    </div>
  );
}
