import { useQuery } from '@tanstack/react-query';
import { Clock, Download, Timer, Users } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/Progress';
import { Skeleton } from '@/components/ui/Skeleton';
import { STABLE_STALE_TIME } from '@/lib/constants';

function formatMinutes(mins: number | null | undefined): string {
  if (mins == null || mins === 0) return '0h';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function TimeReportSkeleton() {
  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div>
        <Skeleton className="h-7 w-48 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="rounded-lg border border-border bg-surface p-5">
        <Skeleton className="h-5 w-32 mb-4" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full mb-3" />
        ))}
      </div>
    </div>
  );
}

/**
 *
 */
export default function TimeReport() {
  const { org, team: teamSlug, project: projectSlug } = useParams();

  const { data: orgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    staleTime: STABLE_STALE_TIME,
  });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
    staleTime: STABLE_STALE_TIME,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);

  const { data: projects } = useQuery({
    queryKey: ['projects', currentTeam?.id],
    queryFn: () => projectsApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });
  const currentProject = projects?.find((p) => p.slug === projectSlug);

  const { data: report, isLoading } = useQuery({
    queryKey: ['time-report', currentProject?.id],
    queryFn: () => projectsApi.timeReport(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  function handleExportCsv() {
    if (!report) return;
    const memberRows = [
      ['Member', 'Logged (min)', 'Logged (hours)', 'Estimated (min)', 'Variance (min)'],
      ...report.members.map((m) => [
        m.displayName,
        m.totalMinutes.toString(),
        (m.totalMinutes / 60).toFixed(1),
        m.estimateMinutes.toString(),
        (m.totalMinutes - m.estimateMinutes).toString(),
      ]),
    ];
    const csv = memberRows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject?.name ?? 'project'}-time-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading || !report) return <TimeReportSkeleton />;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Clock className="h-6 w-6 text-primary" />
            {currentProject?.name} Time Report
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Time logged vs. estimated across team members and issues
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={handleExportCsv}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      {/* Member breakdown */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-text-secondary" />
          Time by Member
        </h2>
        {report.members.length === 0 ? (
          <p className="text-sm text-text-tertiary">No time logged yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-secondary text-left">
                  <th className="pb-2 font-medium">Member</th>
                  <th className="pb-2 font-medium text-right">Logged</th>
                  <th className="pb-2 font-medium text-right">Estimated</th>
                  <th className="pb-2 font-medium text-right">Variance</th>
                  <th className="pb-2 font-medium w-48">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {report.members.map((member) => {
                  const variance = member.totalMinutes - member.estimateMinutes;
                  const pct =
                    member.estimateMinutes > 0
                      ? Math.round((member.totalMinutes / member.estimateMinutes) * 100)
                      : 0;
                  return (
                    <tr key={member.userId}>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar name={member.displayName} size="sm" />
                          <Link
                            to={`/${org}/${teamSlug}/members/${member.username}`}
                            className="font-medium text-text hover:text-primary hover:underline"
                          >
                            {member.displayName}
                          </Link>
                        </div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums font-medium">
                        {formatMinutes(member.totalMinutes)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-text-secondary">
                        {member.estimateMinutes > 0 ? formatMinutes(member.estimateMinutes) : '--'}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {member.estimateMinutes > 0 ? (
                          <span
                            className={
                              variance > 0 ? 'text-danger' : variance < 0 ? 'text-success' : ''
                            }
                          >
                            {variance > 0 ? '+' : ''}
                            {formatMinutes(Math.abs(variance))}
                          </span>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="py-2.5">
                        {member.estimateMinutes > 0 ? (
                          <div className="flex items-center gap-2">
                            <Progress
                              value={Math.min(pct, 100)}
                              size="sm"
                              variant={pct > 100 ? 'danger' : pct >= 75 ? 'warning' : 'primary'}
                            />
                            <span className="text-xs text-text-secondary tabular-nums w-10 text-right">
                              {pct}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-text-tertiary">--</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Issue breakdown */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
          <Timer className="h-4 w-4 text-text-secondary" />
          Time by Issue
        </h2>
        {report.issues.length === 0 ? (
          <p className="text-sm text-text-tertiary">No time logged yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-secondary text-left">
                  <th className="pb-2 font-medium">Issue</th>
                  <th className="pb-2 font-medium text-right">Logged</th>
                  <th className="pb-2 font-medium text-right">Estimated</th>
                  <th className="pb-2 font-medium text-right">Variance</th>
                  <th className="pb-2 font-medium w-48">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {report.issues.map((issue) => {
                  const variance =
                    issue.estimateMinutes != null
                      ? issue.loggedMinutes - issue.estimateMinutes
                      : null;
                  const pct =
                    issue.estimateMinutes && issue.estimateMinutes > 0
                      ? Math.round((issue.loggedMinutes / issue.estimateMinutes) * 100)
                      : 0;
                  return (
                    <tr key={issue.issueId}>
                      <td className="py-2.5">
                        <div className="flex flex-col">
                          <span className="font-medium text-text truncate max-w-md">
                            {issue.title}
                          </span>
                          {issue.sprintName && (
                            <span className="text-xs text-text-tertiary">{issue.sprintName}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums font-medium">
                        {formatMinutes(issue.loggedMinutes)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-text-secondary">
                        {issue.estimateMinutes != null
                          ? formatMinutes(issue.estimateMinutes)
                          : '--'}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {variance != null ? (
                          <span
                            className={
                              variance > 0 ? 'text-danger' : variance < 0 ? 'text-success' : ''
                            }
                          >
                            {variance > 0 ? '+' : ''}
                            {formatMinutes(Math.abs(variance))}
                          </span>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="py-2.5">
                        {issue.estimateMinutes && issue.estimateMinutes > 0 ? (
                          <div className="flex items-center gap-2">
                            <Progress
                              value={Math.min(pct, 100)}
                              size="sm"
                              variant={pct > 100 ? 'danger' : pct >= 75 ? 'warning' : 'primary'}
                            />
                            <span className="text-xs text-text-secondary tabular-nums w-10 text-right">
                              {pct}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-text-tertiary">--</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
