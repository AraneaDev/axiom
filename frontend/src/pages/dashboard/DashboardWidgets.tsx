import type { LucideIcon } from 'lucide-react';
import {
  ListChecks,
  GitPullRequest,
  Activity,
  CalendarClock,
  Clock,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { Link } from 'react-router';

import type { DashboardIssue, DashboardPR, DashboardActivity } from '@/api/dashboard.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { PRIORITY_COLORS } from '@/lib/constants';
import { cn, formatRelative } from '@/lib/utils';

// ─── Widget wrapper ─────────────────────────────────────────

/**
 *
 * @param root0
 * @param root0.icon
 * @param root0.title
 * @param root0.count
 * @param root0.viewAllLink
 * @param root0.children
 * @param root0.className
 */
export function Widget({
  icon: Icon,
  title,
  count,
  viewAllLink,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  viewAllLink?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface flex flex-col', className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm text-text">{title}</h3>
          {count !== undefined && count > 0 && (
            <Badge variant="default" size="sm">
              {count}
            </Badge>
          )}
        </div>
        {viewAllLink && (
          <Link
            to={viewAllLink}
            className="text-xs text-primary hover:text-primary-hover flex items-center gap-1"
          >
            View all <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="overflow-y-auto max-h-80">{children}</div>
    </div>
  );
}

// ─── My Issues widget ───────────────────────────────────────

/**
 *
 * @param root0
 * @param root0.issues
 */
export function MyIssuesWidget({ issues }: { issues: DashboardIssue[] }) {
  // Group by project
  const grouped = issues.reduce<
    Record<string, { project: DashboardIssue['project']; issues: DashboardIssue[] }>
  >((acc, issue) => {
    const key = issue.project.id;
    if (!acc[key]) acc[key] = { project: issue.project, issues: [] };
    acc[key].issues.push(issue);
    return acc;
  }, {});

  return (
    <Widget icon={ListChecks} title="My Issues" count={issues.length}>
      {issues.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-tertiary">
          No open issues assigned to you
        </div>
      ) : (
        <div className="divide-y divide-border">
          {Object.values(grouped).map(({ project, issues: projectIssues }) => (
            <div key={project.id}>
              <div className="px-4 py-2 bg-surface-secondary/50">
                <Link
                  to={`/${project.team.org.slug}/${project.team.slug}/${project.slug}/issues`}
                  className="text-xs font-medium text-text-secondary hover:text-primary"
                >
                  {project.team.org.slug} / {project.team.slug} / {project.name}
                </Link>
              </div>
              {projectIssues.map((issue) => (
                <Link
                  key={issue.id}
                  to={`/${issue.project.team.org.slug}/${issue.project.team.slug}/${issue.project.slug}/issues/${issue.number}`}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-surface-secondary transition-colors"
                >
                  <span className="text-xs font-mono text-text-secondary w-14 shrink-0">
                    {issue.key}
                  </span>
                  <span className="text-sm truncate flex-1">{issue.title}</span>
                  <span
                    className={cn(
                      'text-xs px-2 py-0.5 rounded-full shrink-0',
                      PRIORITY_COLORS[issue.priority as keyof typeof PRIORITY_COLORS],
                    )}
                  >
                    {issue.priority}
                  </span>
                  {issue.column && (
                    <span className="text-xs text-text-tertiary shrink-0">{issue.column.name}</span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </Widget>
  );
}

// ─── Review Requests widget ─────────────────────────────────

/**
 *
 * @param root0
 * @param root0.prs
 */
export function ReviewRequestsWidget({ prs }: { prs: DashboardPR[] }) {
  return (
    <Widget icon={GitPullRequest} title="Review Requests" count={prs.length}>
      {prs.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-tertiary">No pending review requests</div>
      ) : (
        <div className="divide-y divide-border">
          {prs.map((pr) => {
            const prLink = pr.repo.team
              ? `/${pr.repo.team.org.slug}/${pr.repo.team.slug}/repos/${pr.repo.slug}/pulls/${pr.number}`
              : null;
            const content = (
              <>
                <GitPullRequest className="h-4 w-4 text-success shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{pr.title}</p>
                  <p className="text-xs text-text-tertiary">
                    {pr.repo.name} #{pr.number} by {pr.author.displayName}
                  </p>
                </div>
                <span className="text-xs text-text-tertiary shrink-0 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {formatRelative(pr.createdAt)}
                </span>
              </>
            );
            return prLink ? (
              <Link
                key={pr.id}
                to={prLink}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-secondary transition-colors"
              >
                {content}
              </Link>
            ) : (
              <div
                key={pr.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-secondary transition-colors"
              >
                {content}
              </div>
            );
          })}
        </div>
      )}
    </Widget>
  );
}

// ─── Recent Activity widget ─────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  created: 'created',
  updated: 'updated',
  status_changed: 'changed status of',
  assigned: 'assigned',
  unassigned: 'unassigned',
  commented: 'commented on',
  merged: 'merged',
  closed: 'closed',
  labeled: 'labeled',
  priority_changed: 'changed priority of',
  type_changed: 'changed type of',
  review_submitted: 'reviewed',
  deleted: 'deleted',
  time_logged: 'logged time on',
  suggestion_applied: 'applied suggestion on',
  suggestions_batch_applied: 'applied suggestions on',
};

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  issue: 'issue',
  pull_request: 'PR',
  wiki_page: 'page',
  repository: 'repo',
};

function formatActivityDetails(action: string, details: Record<string, unknown> | null): string {
  if (!details) return '';
  if (action === 'status_changed' && details.fromName && details.toName)
    return `${details.fromName} -> ${details.toName}`;
  if (action === 'priority_changed' && details.from && details.to)
    return `${details.from} -> ${details.to}`;
  if (action === 'updated' && details.field) return String(details.field);
  if (action === 'review_submitted' && details.status) {
    const m: Record<string, string> = {
      APPROVED: 'approved',
      CHANGES_REQUESTED: 'requested changes',
      COMMENTED: 'commented',
    };
    return m[String(details.status)] ?? '';
  }
  return '';
}

/**
 *
 * @param root0
 * @param root0.activities
 */
export function RecentActivityWidget({ activities }: { activities: DashboardActivity[] }) {
  return (
    <Widget icon={Activity} title="Recent Activity" count={activities.length}>
      {activities.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-tertiary">No recent activity</div>
      ) : (
        <div className="divide-y divide-border">
          {activities.map((a) => {
            const actionLabel = ACTION_LABELS[a.action] ?? a.action;
            const typeLabel = RESOURCE_TYPE_LABELS[a.resourceType] ?? a.resourceType;
            const detail = formatActivityDetails(a.action, a.details);

            const resourceContent = a.resourceTitle ? (
              <>
                {a.resourceKey && (
                  <span className="font-mono text-xs text-text-secondary">{a.resourceKey}</span>
                )}{' '}
                <span className="text-text truncate">{a.resourceTitle}</span>
              </>
            ) : (
              <span className="text-text-secondary">{typeLabel}</span>
            );

            return (
              <div key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                <Avatar
                  name={a.user.displayName}
                  src={a.user.avatarUrl ?? undefined}
                  size="sm"
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-snug">
                    <span className="font-medium">{a.user.displayName}</span>{' '}
                    <span className="text-text-secondary">{actionLabel}</span>{' '}
                    {a.resourceLink ? (
                      <Link
                        to={a.resourceLink}
                        className="text-primary hover:text-primary-hover hover:underline"
                      >
                        {resourceContent}
                      </Link>
                    ) : (
                      resourceContent
                    )}
                  </p>
                  {detail && <p className="text-xs text-text-tertiary mt-0.5">{detail}</p>}
                </div>
                <span className="text-xs text-text-tertiary shrink-0 mt-0.5">
                  {formatRelative(a.createdAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Widget>
  );
}

// ─── Upcoming Due Dates widget ──────────────────────────────

/**
 *
 * @param root0
 * @param root0.issues
 */
export function UpcomingDueDatesWidget({ issues }: { issues: DashboardIssue[] }) {
  const getDaysRemaining = (dueDate: string) => {
    const now = new Date();
    const due = new Date(dueDate);
    return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getDueBadgeClass = (days: number) => {
    if (days < 0) return 'bg-danger-light text-danger';
    if (days < 3) return 'bg-warning/10 text-warning';
    return 'bg-surface-secondary text-text-secondary';
  };

  const getDueLabel = (days: number) => {
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    return `${days}d left`;
  };

  return (
    <Widget icon={CalendarClock} title="Upcoming Due Dates" count={issues.length}>
      {issues.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-tertiary">No upcoming deadlines</div>
      ) : (
        <div className="divide-y divide-border">
          {issues.map((issue) => {
            const days = getDaysRemaining(issue.dueDate!);
            return (
              <Link
                key={issue.id}
                to={`/${issue.project.team.org.slug}/${issue.project.team.slug}/${issue.project.slug}/issues/${issue.number}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-secondary transition-colors"
              >
                {days < 3 && <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />}
                <span className="text-xs font-mono text-text-secondary w-14 shrink-0">
                  {issue.key}
                </span>
                <span className="text-sm truncate flex-1">{issue.title}</span>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full shrink-0',
                    getDueBadgeClass(days),
                  )}
                >
                  {getDueLabel(days)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Widget>
  );
}
