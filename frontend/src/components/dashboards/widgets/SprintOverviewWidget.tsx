import { Ban } from 'lucide-react';

import type { SprintEntry } from '@/api/dashboards.api';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function daysText(daysLeft: number): string {
  return daysLeft < 0 ? `${plural(-daysLeft, 'day')} over` : `${plural(daysLeft, 'day')} left`;
}

function blockersText(blockedBy: SprintEntry['blocked'][number]['blockedBy']): string {
  return blockedBy.map((blocker) => blocker.key ?? 'a hidden issue').join(', ');
}

function SprintRow({ sprint }: { sprint: SprintEntry }) {
  const { issues, points, blocked } = sprint;
  const percent = issues.total > 0 ? Math.round((issues.done / issues.total) * 100) : 0;
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2 mb-1.5">
        <Badge variant="outline" size="sm">
          {sprint.project.key}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{sprint.name}</span>
        <span
          className={`text-xs shrink-0 ${sprint.daysLeft < 0 ? 'text-danger' : 'text-text-tertiary'}`}
        >
          {daysText(sprint.daysLeft)}
        </span>
      </div>
      <Progress value={percent} size="sm" />
      <div className="flex justify-between gap-2 mt-1.5 text-xs text-text-secondary">
        <span>{`${issues.done} of ${issues.total} issues done`}</span>
        <span>{`${points.done} of ${points.committed} points`}</span>
      </div>
      {blocked.length > 0 && (
        <ul className="mt-2 space-y-1">
          {blocked.map((issue) => (
            <li key={issue.key} className="flex items-start gap-1.5 text-xs text-warning">
              <Ban className="h-3 w-3 shrink-0 mt-0.5" />
              <span className="min-w-0">
                <span className="font-mono">{issue.key}</span>
                {` blocked by ${blockersText(issue.blockedBy)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The progress of the sprints the viewer can see, with what is blocked.
 * @param root0
 * @param root0.sprints
 */
export function SprintOverviewWidget({ sprints }: { sprints: SprintEntry[] }) {
  if (sprints.length === 0) return <p className="text-sm text-text-secondary">No sprints</p>;
  return (
    <ul className="divide-y divide-border-light">
      {sprints.map((sprint) => (
        <SprintRow key={sprint.id} sprint={sprint} />
      ))}
    </ul>
  );
}
