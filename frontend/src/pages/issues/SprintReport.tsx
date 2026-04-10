import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  ArrowUpDown,
  ArrowLeft,
  Plus,
  Minus,
  Target,
  Calendar,
} from 'lucide-react';
import { useParams, useNavigate } from 'react-router';

import { sprintReportApi } from '@/api/sprint-report.api';
import type { SprintReportIssue, SprintReportScopeChange } from '@/api/sprint-report.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { GaugeChart } from '@/components/ui/charts';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { useProjectContext } from '@/hooks/useProjectContext';
import { formatTimestamp } from '@/lib/format';
import { cn, formatDate } from '@/lib/utils';

function StatCard({
  label,
  count,
  points,
  icon: Icon,
  variant,
}: {
  label: string;
  count: number;
  points: number;
  icon: React.ComponentType<{ className?: string }>;
  variant: 'default' | 'success' | 'warning' | 'info';
}) {
  const variantStyles = {
    default: 'border-border',
    success: 'border-status-success/30',
    warning: 'border-status-warning/30',
    info: 'border-primary/30',
  };

  return (
    <div
      className={cn('rounded-lg border bg-surface p-4 flex flex-col gap-1', variantStyles[variant])}
    >
      <div className="flex items-center gap-2 text-text-secondary text-xs">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <div className="text-2xl font-semibold text-text tabular-nums">{count}</div>
      <div className="text-xs text-text-tertiary tabular-nums">{points} story points</div>
    </div>
  );
}

function IssueTable({
  title,
  issues,
  org,
  team,
  project,
  showDestination,
}: {
  title: string;
  issues: SprintReportIssue[];
  org: string;
  team: string;
  project: string;
  showDestination?: boolean;
}) {
  const navigate = useNavigate();

  if (issues.length === 0) return null;

  return (
    <Card>
      <div className="px-4 py-3 border-b border-border-light">
        <h3 className="text-sm font-medium text-text">
          {title} ({issues.length})
        </h3>
      </div>
      <div className="divide-y divide-border-light">
        {issues.map((issue) => (
          <div
            key={issue.id}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-tertiary transition-colors"
          >
            {issue.type && <IssueTypeIcon type={issue.type} className="h-4 w-4 shrink-0" />}
            {!issue.type && <Circle className="h-4 w-4 shrink-0 text-text-tertiary" />}
            <Button
              variant="ghost"
              size="xs"
              className="font-mono text-xs text-text-secondary hover:text-primary shrink-0 px-1"
              onClick={() => navigate(`/${org}/${team}/${project}/issues/${issue.number}`)}
            >
              <Target className="h-3 w-3" /> #{issue.number}
            </Button>
            <span className="text-sm text-text truncate flex-1">{issue.title}</span>
            {issue.addedMidSprint && (
              <Badge variant="primary" className="text-[9px]">
                Mid-sprint
              </Badge>
            )}
            {issue.storyPoints != null && (
              <span className="text-[10px] bg-surface-tertiary text-text-secondary px-1.5 py-0.5 rounded-full tabular-nums">
                {issue.storyPoints} SP
              </span>
            )}
            {issue.columnName && <Badge variant="default">{issue.columnName}</Badge>}
            {showDestination && issue.destination && (
              <Badge variant="default" className="text-[9px]">
                {issue.destination}
              </Badge>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ScopeChangesSection({
  changes,
  org,
  team,
  project,
}: {
  changes: SprintReportScopeChange[];
  org: string;
  team: string;
  project: string;
}) {
  const navigate = useNavigate();

  if (changes.length === 0) return null;

  return (
    <Card>
      <div className="px-4 py-3 border-b border-border-light">
        <h3 className="text-sm font-medium text-text flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4" /> Scope Changes ({changes.length})
        </h3>
      </div>
      <div className="divide-y divide-border-light">
        {changes.map((change, idx) => (
          <div key={`${change.issueId}-${idx}`} className="flex items-center gap-3 px-4 py-2.5">
            <span className="text-[10px] text-text-tertiary tabular-nums whitespace-nowrap">
              {formatTimestamp(change.timestamp)}
            </span>
            {change.action === 'ADDED' ? (
              <Badge variant="success" className="text-[9px] flex items-center gap-1">
                <Plus className="h-3 w-3" /> Added
              </Badge>
            ) : (
              <Badge variant="danger" className="text-[9px] flex items-center gap-1">
                <Minus className="h-3 w-3" /> Removed
              </Badge>
            )}
            <Button
              variant="ghost"
              size="xs"
              className="font-mono text-xs text-text-secondary hover:text-primary px-1"
              onClick={() => navigate(`/${org}/${team}/${project}/issues/${change.issueNumber}`)}
            >
              <Target className="h-3 w-3" /> #{change.issueNumber}
            </Button>
            <span className="text-sm text-text truncate">{change.issueTitle}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Sprint report page showing completed vs incomplete issues with scope change tracking.
 */
export default function SprintReport() {
  const { org, team, project, sprintId } = useParams();
  const navigate = useNavigate();
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['sprint-report', projectId, sprintId],
    queryFn: () => sprintReportApi.get(projectId!, sprintId!),
    enabled: !!projectId && !!sprintId,
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <AlertCircle className="h-8 w-8 text-status-error mx-auto mb-2" />
          <p className="text-text-secondary">{(error as Error).message}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => navigate(`/${org}/${team}/${project}/backlog`)}
          >
            <ArrowLeft className="h-4 w-4" /> Back to Backlog
          </Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { sprint, summary, completedIssues, incompleteIssues, scopeChanges } = data;
  const startStr = formatDate(sprint.startDate);
  const endStr = formatDate(sprint.endDate);

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 text-text-secondary"
          onClick={() => navigate(`/${org}/${team}/${project}/backlog`)}
        >
          <ArrowLeft className="h-4 w-4" /> Back to Backlog
        </Button>
        <PageHeader title={sprint.name} prefix="Sprint Report" />
        {sprint.goal && <p className="text-sm text-text-secondary -mt-3 mb-2">{sprint.goal}</p>}
        <div className="flex items-center gap-3 text-xs text-text-tertiary">
          <Badge variant={sprint.status === 'COMPLETED' ? 'success' : 'primary'}>
            {sprint.status}
          </Badge>
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" /> {startStr} - {endStr}
          </span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Committed"
          count={summary.committedCount}
          points={summary.committedPoints}
          icon={Circle}
          variant="info"
        />
        <StatCard
          label="Completed"
          count={summary.completedCount}
          points={summary.completedPoints}
          icon={CheckCircle2}
          variant="success"
        />
        <StatCard
          label="Incomplete"
          count={summary.incompleteCount}
          points={summary.incompletePoints}
          icon={AlertCircle}
          variant="warning"
        />
        <StatCard
          label="Scope Changes"
          count={summary.addedMidSprintCount + summary.removedMidSprintCount}
          points={0}
          icon={ArrowUpDown}
          variant="default"
        />
      </div>

      {/* Completion gauges */}
      {summary.committedCount > 0 && (
        <Card>
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-medium text-text">Sprint Completion</h3>
          </div>
          <div className="flex items-center justify-center gap-12 py-6">
            <GaugeChart
              value={Math.round((summary.completedCount / summary.committedCount) * 100)}
              label="Issues"
              size={130}
            />
            {summary.committedPoints > 0 && (
              <GaugeChart
                value={Math.round((summary.completedPoints / summary.committedPoints) * 100)}
                label="Story Points"
                size={130}
              />
            )}
          </div>
        </Card>
      )}

      {/* Completed issues */}
      <IssueTable
        title="Completed Issues"
        issues={completedIssues}
        org={org!}
        team={team!}
        project={project!}
      />

      {/* Incomplete issues */}
      <IssueTable
        title="Incomplete Issues"
        issues={incompleteIssues}
        org={org!}
        team={team!}
        project={project!}
        showDestination
      />

      {/* Scope changes */}
      <ScopeChangesSection changes={scopeChanges} org={org!} team={team!} project={project!} />
    </div>
  );
}
