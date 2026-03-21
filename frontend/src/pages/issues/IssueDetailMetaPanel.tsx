import { ChevronRight, Plus } from 'lucide-react';
import { Link } from 'react-router';

import IssueDevelopmentCard from './IssueDevelopmentCard';
import { IssueLinkedSection } from './IssueLinkedSection';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import type { Issue } from '@/lib/types';
import { cn } from '@/lib/utils';

interface IssueLink {
  id: string;
  type: string;
  fromId: string;
  fromKey: string;
  toKey: string;
  from: {
    id: string;
    number: number;
    title: string;
    project: { slug: string; prefix: string; team: { slug: string; org: { slug: string } } };
  };
  to: {
    id: string;
    number: number;
    title: string;
    project: { slug: string; prefix: string; team: { slug: string; org: { slug: string } } };
  };
}

interface IssueDetailMetaPanelProps {
  issue: Issue;
  projectId: string;
  org: string;
  teamSlug: string;
  projectSlug: string;
  children: Issue[];
  progress: { total: number; completed: number; percentage: number } | undefined;
  links: IssueLink[];
  repos: { id: string; slug: string; name: string; defaultBranch: string }[];
}

/**
 *
 * @param root0
 * @param root0.issue
 * @param root0.projectId
 * @param root0.org
 * @param root0.teamSlug
 * @param root0.projectSlug
 * @param root0.children
 * @param root0.progress
 * @param root0.links
 * @param root0.repos
 */
export function IssueDetailMetaPanel({
  issue,
  projectId,
  org,
  teamSlug,
  projectSlug,
  children: childIssues,
  progress,
  links,
  repos,
}: IssueDetailMetaPanelProps) {
  return (
    <>
      {/* Sub-issues */}
      <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Sub-issues</h3>
          <Link to={`/${org}/${teamSlug}/${projectSlug}/issues/new`}>
            <Button variant="ghost" size="sm" title="Add sub-issue">
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </Link>
        </div>
        {progress && progress.total > 0 && (
          <div className="mb-2">
            <div className="flex items-center justify-between text-[10px] text-text-tertiary mb-1">
              <span>
                {progress.completed} of {progress.total} completed
              </span>
              <span>{progress.percentage}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-primary-light overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
          </div>
        )}
        {childIssues.length > 0 ? (
          <div className="space-y-0.5">
            {childIssues.map((child) => (
              <Link
                key={child.id}
                to={`/${org}/${teamSlug}/${projectSlug}/issues/${child.number}`}
                className="flex items-center gap-2 py-1 px-1 rounded hover:bg-surface-secondary transition-colors group"
              >
                <IssueTypeIcon type={child.type} className="h-3.5 w-3.5 shrink-0" />
                <span className="font-mono text-[10px] text-text-tertiary shrink-0">
                  {child.key}
                </span>
                <span
                  className={cn(
                    'text-xs truncate flex-1',
                    child.column?.isDone && 'line-through text-text-tertiary',
                  )}
                >
                  {child.title}
                </span>
                {child.column && (
                  <Badge
                    variant={child.column.isDone ? 'default' : 'primary'}
                    className="text-[10px] px-1.5"
                  >
                    {child.column.name}
                  </Badge>
                )}
                <ChevronRight className="h-3 w-3 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-tertiary">No sub-issues yet.</p>
        )}
      </div>

      {/* Development Card */}
      <IssueDevelopmentCard
        projectId={projectId}
        issueNumber={issue.number}
        issueId={issue.id}
        org={org}
        teamSlug={teamSlug}
        repos={repos}
      />

      {/* Linked Issues */}
      <IssueLinkedSection
        issueId={issue.id}
        issueNumber={issue.number}
        projectId={projectId}
        links={links}
      />
    </>
  );
}
