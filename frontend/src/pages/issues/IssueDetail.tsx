import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router';

import { IssueDetailComments } from './IssueDetailComments';
import { IssueDetailSidebar } from './IssueDetailSidebar';

import { activityApi } from '@/api/activity.api';
import { issuesApi } from '@/api/issues.api';
import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { reposApi } from '@/api/repos.api';
import { sprintsApi } from '@/api/sprints.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { PageLoader } from '@/components/ui/Spinner';
import { formatRelative } from '@/lib/utils';

/**
 *
 */
export default function IssueDetail() {
  const { org, team: teamSlug, project: projectSlug, num } = useParams();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);
  const { data: projects } = useQuery({
    queryKey: ['projects', currentTeam?.id],
    queryFn: () => projectsApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });
  const currentProject = projects?.find((p) => p.slug === projectSlug);

  const { data: issue, isLoading } = useQuery({
    queryKey: ['issue', currentProject?.id, num],
    queryFn: () => issuesApi.get(currentProject!.id, parseInt(num!)),
    enabled: !!currentProject?.id && !!num,
  });

  const { data: repos = [] } = useQuery({
    queryKey: ['repos', currentTeam?.id],
    queryFn: () => reposApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  const { data: teamDetail } = useQuery({
    queryKey: ['team-detail', currentTeam?.id],
    queryFn: () => teamsApi.get(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  const { data: links = [] } = useQuery({
    queryKey: ['issue-links', currentProject?.id, issue?.number],
    queryFn: () => issuesApi.listLinks(currentProject!.id, issue!.number),
    enabled: !!currentProject?.id && !!issue?.number,
  });

  const { data: sprints = [] } = useQuery({
    queryKey: ['sprints', currentProject?.id],
    queryFn: () => sprintsApi.list(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const { data: activityData } = useQuery({
    queryKey: ['activity', currentProject?.id, num],
    queryFn: () => activityApi.listIssueActivity(currentProject!.id, parseInt(num!), { limit: 50 }),
    enabled: !!currentProject?.id && !!num,
  });

  const { data: children = [] } = useQuery({
    queryKey: ['issue-children', currentProject?.id, issue?.number],
    queryFn: () => issuesApi.getChildren(currentProject!.id, issue!.number),
    enabled: !!currentProject?.id && !!issue?.number,
  });

  const { data: progress } = useQuery({
    queryKey: ['issue-progress', currentProject?.id, issue?.number],
    queryFn: () => issuesApi.getProgress(currentProject!.id, issue!.number),
    enabled: !!currentProject?.id && !!issue?.number && children.length > 0,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      issuesApi.update(currentProject!.id, parseInt(num!), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', currentProject?.id, num] });
      queryClient.invalidateQueries({ queryKey: ['board', currentProject?.id] });
      queryClient.invalidateQueries({ queryKey: ['issues', currentProject?.id] });
      queryClient.invalidateQueries({ queryKey: ['activity', currentProject?.id, num] });
      setEditingTitle(false);
      setEditingField(null);
    },
  });

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  if (isLoading) return <PageLoader />;
  if (!issue) return <div className="text-center py-16 text-text-secondary">Issue not found</div>;

  function startEditTitle() {
    setTitleDraft(issue!.title);
    setEditingTitle(true);
  }

  function saveTitle() {
    if (titleDraft.trim() && titleDraft !== issue!.title) {
      updateMutation.mutate({ title: titleDraft });
    } else {
      setEditingTitle(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col lg:grid lg:grid-cols-[1fr_320px] gap-8">
        {/* Main content */}
        <div className="min-w-0">
          <div className="flex items-start gap-3 mb-6">
            <IssueTypeIcon type={issue.type} className="h-5 w-5 mt-1.5 shrink-0" />
            <div className="flex-1 min-w-0">
              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <Input
                    ref={titleInputRef}
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTitle();
                      if (e.key === 'Escape') setEditingTitle(false);
                    }}
                    className="flex-1 text-xl font-semibold bg-transparent border-b-2 border-primary outline-none py-0.5"
                  />
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={saveTitle}
                    className="text-success"
                    title="Save"
                    aria-label="Save"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setEditingTitle(false)}
                    className="text-text-tertiary"
                    title="Cancel"
                    aria-label="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <h1 className="text-xl font-semibold group cursor-pointer" onClick={startEditTitle}>
                  {issue.title}
                  <Pencil className="h-3.5 w-3.5 ml-2 inline opacity-0 group-hover:opacity-40 transition-opacity" />
                </h1>
              )}
              <p className="text-sm text-text-tertiary mt-1">
                {issue.key} &middot; opened {formatRelative(issue.createdAt)} by{' '}
                {issue.creator?.displayName}
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="rounded-lg border border-border bg-surface p-5 mb-8">
            {issue.body ? (
              <MarkdownRenderer
                content={issue.body}
                basePath={`/${org}/${teamSlug}/${projectSlug}`}
              />
            ) : (
              <p className="text-text-tertiary italic text-sm">No description provided.</p>
            )}
          </div>

          {/* Comments and activity */}
          <IssueDetailComments
            issue={issue}
            projectId={currentProject!.id}
            num={num!}
            activities={activityData?.activities ?? []}
            commentBody={commentBody}
            onCommentBodyChange={setCommentBody}
            basePath={`/${org}/${teamSlug}/${projectSlug}`}
          />
        </div>

        {/* Sidebar */}
        <IssueDetailSidebar
          issue={issue}
          projectId={currentProject!.id}
          num={num!}
          org={org!}
          teamSlug={teamSlug!}
          projectSlug={projectSlug!}
          teamMembers={teamDetail?.members}
          sprints={sprints}
          children={children}
          progress={progress}
          links={links}
          repos={repos}
          editingField={editingField}
          onEditField={setEditingField}
          onUpdate={(data) => updateMutation.mutate(data)}
        />
      </div>
    </div>
  );
}
