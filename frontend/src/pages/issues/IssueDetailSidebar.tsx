import { History } from 'lucide-react';

import { IssueDetailFieldsPanel } from './IssueDetailFieldsPanel';
import { IssueDetailMetaPanel } from './IssueDetailMetaPanel';

import { type ActivityEvent } from '@/api/activity.api';
import { ActivityFeed } from '@/components/ActivityFeed';
import { Card } from '@/components/ui/Card';
import type { Issue, Sprint } from '@/lib/types';

interface TeamMember {
  user: { id: string; displayName: string };
}

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

interface IssueDetailSidebarProps {
  issue: Issue;
  projectId: string;
  num: string;
  org: string;
  teamSlug: string;
  projectSlug: string;
  teamMembers: TeamMember[] | undefined;
  sprints: Sprint[];
  children: Issue[];
  progress: { total: number; completed: number; percentage: number } | undefined;
  links: IssueLink[];
  repos: { id: string; slug: string; name: string; defaultBranch: string }[];
  activities: ActivityEvent[];
  editingField: string | null;
  onEditField: (field: string | null) => void;
  onUpdate: (data: Record<string, unknown>) => void;
  isUpdating?: boolean;
}

/**
 *
 * @param root0
 * @param root0.issue
 * @param root0.projectId
 * @param root0.num
 * @param root0.org
 * @param root0.teamSlug
 * @param root0.projectSlug
 * @param root0.teamMembers
 * @param root0.sprints
 * @param root0.children
 * @param root0.progress
 * @param root0.links
 * @param root0.repos
 * @param root0.activities
 * @param root0.editingField
 * @param root0.onEditField
 * @param root0.onUpdate
 * @param root0.isUpdating
 */
export function IssueDetailSidebar({
  issue,
  projectId,
  num,
  org,
  teamSlug,
  projectSlug,
  teamMembers,
  sprints,
  children: childIssues,
  progress,
  links,
  repos,
  activities,
  editingField,
  onEditField,
  onUpdate,
  isUpdating,
}: IssueDetailSidebarProps) {
  return (
    <div className="space-y-3">
      <IssueDetailFieldsPanel
        issue={issue}
        projectId={projectId}
        num={num}
        teamMembers={teamMembers}
        sprints={sprints}
        editingField={editingField}
        onEditField={onEditField}
        onUpdate={onUpdate}
        isUpdating={isUpdating}
      />

      <IssueDetailMetaPanel
        issue={issue}
        projectId={projectId}
        org={org}
        teamSlug={teamSlug}
        projectSlug={projectSlug}
        progress={progress}
        links={links}
        repos={repos}
      >
        {childIssues}
      </IssueDetailMetaPanel>

      {activities.length > 0 && (
        <Card className="p-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-text-tertiary mb-2.5 flex items-center gap-2">
            <History className="h-3.5 w-3.5" />
            History
          </h3>
          <ActivityFeed activities={activities} />
        </Card>
      )}
    </div>
  );
}
