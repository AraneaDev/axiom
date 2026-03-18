import type { VelocityDataPoint } from '@/lib/types';

/**
 * Simple bar chart showing story points completed per sprint.
 * Uses inline div bars -- no chart library needed.
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

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-text">Velocity</span>
        <span className="text-xs text-text-secondary">Avg: {avgPoints} pts/sprint</span>
      </div>

      <div className="flex items-end gap-2" style={{ height: 120 }}>
        {data.map((d) => {
          const heightPct = maxPoints > 0 ? (d.completedPoints / maxPoints) * 100 : 0;
          return (
            <div key={d.sprintId} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] text-text-secondary tabular-nums">
                {d.completedPoints}
              </span>
              <div
                className="w-full rounded-t bg-primary transition-all duration-300 min-h-[2px]"
                style={{ height: `${Math.max(heightPct, 2)}%` }}
                title={`${d.sprintName}: ${d.completedPoints} points (${d.issueCount} issues)`}
              />
              <span
                className="text-[9px] text-text-tertiary truncate max-w-full text-center"
                title={d.sprintName}
              >
                {d.sprintName}
              </span>
            </div>
          );
        })}
      </div>

      {/* Average line indicator */}
      {avgPoints > 0 && (
        <div className="mt-2 border-t border-dashed border-border-light pt-1">
          <span className="text-[10px] text-text-tertiary">
            Average velocity: {avgPoints} story points per sprint
          </span>
        </div>
      )}
    </div>
  );
}
