import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUp, Check, Eye, EyeOff, Paperclip, Pencil, X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router';


import { IssueDetailComments } from './IssueDetailComments';
import { IssueDetailSidebar } from './IssueDetailSidebar';

import { activityApi } from '@/api/activity.api';
import { attachmentsApi } from '@/api/attachments.api';
import { issuesApi } from '@/api/issues.api';
import { reposApi } from '@/api/repos.api';
import { sprintsApi } from '@/api/sprints.api';
import { teamsApi } from '@/api/teams.api';
import { useProjectContext } from '@/hooks/useProjectContext';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { AttachmentList } from '@/components/ui/AttachmentList';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FileUpload } from '@/components/ui/FileUpload';
import { Input } from '@/components/ui/Input';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { DetailSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { STABLE_STALE_TIME } from '@/lib/constants';
import { cn, formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

/**
 *
 */
export default function IssueDetail() {
  const { org, teamSlug, projectSlug, currentTeam, currentProject } = useProjectContext();
  const { num } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [commentBody, setCommentBody] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingBody, setEditingBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const { data: issue, isLoading, isError } = useQuery({
    queryKey: ['issue', currentProject?.id, num],
    queryFn: () => issuesApi.get(currentProject!.id, parseInt(num!)),
    enabled: !!currentProject?.id && !!num,
  });

  const { data: voteData } = useQuery({
    queryKey: ['issue-votes', currentProject?.id, num],
    queryFn: () => issuesApi.getVotes(currentProject!.id, parseInt(num!)),
    enabled: !!currentProject?.id && !!num,
  });

  const voteMutation = useMutation({
    mutationFn: () => issuesApi.toggleVote(currentProject!.id, parseInt(num!)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-votes', currentProject?.id, num] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['board'] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Operation failed'),
  });

  const { data: watcherData } = useQuery({
    queryKey: ['issue-watchers', currentProject?.id, num],
    queryFn: () => issuesApi.getWatchers(currentProject!.id, parseInt(num!)),
    enabled: !!currentProject?.id && !!num,
  });

  const watchMutation = useMutation({
    mutationFn: () => issuesApi.toggleWatch(currentProject!.id, parseInt(num!)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-watchers', currentProject?.id, num] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['board'] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Operation failed'),
  });

  const { data: repos = [] } = useQuery({
    queryKey: ['repos', currentTeam?.id],
    queryFn: () => reposApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
    staleTime: STABLE_STALE_TIME,
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

  const { user } = useAuthStore();

  const { data: attachments = [] } = useQuery({
    queryKey: ['attachments', issue?.id],
    queryFn: () => attachmentsApi.list({ issueId: issue!.id }),
    enabled: !!issue?.id,
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (id: string) => attachmentsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', issue?.id] }),
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Operation failed'),
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
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Operation failed'),
  });

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  if (isLoading) return <DetailSkeleton />;
  if (isError) {
    return <EmptyState icon={<AlertTriangle />} title="Failed to load issue" description="Something went wrong loading this issue." />;
  }
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
    <div className="px-6 py-4">
      <div className="flex flex-col lg:grid lg:grid-cols-[1fr_340px] gap-8">
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
                    className="flex-1 text-2xl font-bold bg-transparent border-b-2 border-primary outline-none py-0.5"
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
                <h1 className="text-2xl font-bold group cursor-pointer" onClick={startEditTitle}>
                  {issue.title}
                  <Pencil className="h-3.5 w-3.5 ml-2 inline opacity-0 group-hover:opacity-40 transition-opacity" />
                </h1>
              )}
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm text-text-tertiary">
                  {issue.key} &middot; opened {formatRelative(issue.createdAt)} by{' '}
                  {issue.creator?.displayName}
                </p>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => voteMutation.mutate()}
                  className={cn(
                    'ml-2 gap-1',
                    voteData?.voted && 'border-primary bg-primary/10 text-primary',
                  )}
                  title={voteData?.voted ? 'Remove vote' : 'Vote for this issue'}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  {voteData?.count ?? 0}
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => watchMutation.mutate()}
                  className={cn(
                    'gap-1',
                    watcherData?.watching && 'border-primary bg-primary/10 text-primary',
                  )}
                  title={watcherData?.watching ? 'Stop watching this issue' : 'Watch this issue'}
                >
                  {watcherData?.watching ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  {watcherData?.watchers?.length ?? 0}
                </Button>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="rounded-lg border border-border bg-surface p-5 mb-8">
            {editingBody ? (
              <div className="space-y-2">
                <MarkdownEditor
                  value={bodyDraft}
                  onChange={setBodyDraft}
                  projectId={currentProject?.id}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      updateMutation.mutate({ body: bodyDraft });
                      setEditingBody(false);
                    }}
                  >
                    <Check className="h-4 w-4" /> Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingBody(false)}>
                    <X className="h-4 w-4" /> Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="group relative">
                {issue.body ? (
                  <MarkdownRenderer
                    content={issue.body}
                    basePath={`/${org}/${teamSlug}/${projectSlug}`}
                  />
                ) : (
                  <p className="text-text-tertiary italic text-sm">No description provided.</p>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 absolute top-0 right-0 transition-opacity"
                  title="Edit description"
                  onClick={() => {
                    setBodyDraft(issue.body ?? '');
                    setEditingBody(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* Attachments */}
          <div className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary mb-3 flex items-center gap-2">
              <Paperclip className="h-3.5 w-3.5" />
              Attachments
              {attachments.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-surface-tertiary px-2 py-0.5 text-xs font-medium text-text-secondary normal-case tracking-normal">
                  {attachments.length}
                </span>
              )}
            </h2>
            <AttachmentList
              attachments={attachments}
              currentUserId={user?.id}
              onDelete={(id) => deleteAttachmentMutation.mutate(id)}
            />
            <FileUpload
              className="mt-3"
              uploadFn={(file) => attachmentsApi.upload(file, { issueId: issue.id })}
              onUpload={() =>
                queryClient.invalidateQueries({ queryKey: ['attachments', issue.id] })
              }
            />
          </div>

          {/* Comments and activity */}
          <IssueDetailComments
            issue={issue}
            projectId={currentProject!.id}
            num={num!}
            commentBody={commentBody}
            onCommentBodyChange={setCommentBody}
            basePath={`/${org}/${teamSlug}/${projectSlug}`}
            orgSlug={org}
            teamSlug={teamSlug}
          />
        </div>

        {/* Sidebar */}
        <div className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
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
            activities={activityData?.activities ?? []}
            editingField={editingField}
            onEditField={setEditingField}
            onUpdate={(data) => updateMutation.mutate(data)}
            isUpdating={updateMutation.isPending}
          />
        </div>
      </div>
    </div>
  );
}
