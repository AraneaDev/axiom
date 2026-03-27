import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUp, Check, Eye, EyeOff, Paperclip, Pencil, X } from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useParams } from 'react-router';

import { IssueDetailComments } from './IssueDetailComments';
import { IssueDetailSidebar } from './IssueDetailSidebar';

import { activityApi } from '@/api/activity.api';
import { attachmentsApi } from '@/api/attachments.api';
import { hydrateApi } from '@/api/hydrate.api';
import { issuesApi } from '@/api/issues.api';
import { reposApi } from '@/api/repos.api';
import { sprintsApi } from '@/api/sprints.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { AttachmentList } from '@/components/ui/AttachmentList';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FileUpload } from '@/components/ui/FileUpload';
import { Input } from '@/components/ui/Input';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { DetailSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useDraftState } from '@/hooks/useDraftState';
import { useIssueInvalidation } from '@/hooks/useIssueInvalidation';
import { useProjectContext } from '@/hooks/useProjectContext';
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
  const { draft: commentBody, setDraft: setCommentBody, reset: resetComment } = useDraftState('');
  const titleDraftState = useDraftState('');
  const bodyDraftState = useDraftState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const { invalidateAll } = useIssueInvalidation(currentProject?.id ?? '', num);

  // Hydration: single request for all issue detail data
  const hydrationQuery = useQuery({
    queryKey: ['issue-hydrate', currentProject?.id, num],
    queryFn: () => hydrateApi.issueDetail(currentProject!.id, parseInt(num!)),
    enabled: !!currentProject?.id && !!num,
    retry: 1,
    staleTime: 30_000,
  });

  // Seed individual caches from hydration response
  const numInt = num ? parseInt(num) : undefined;
  const hydrationMappings = useMemo(
    () => [
      { key: ['issue', currentProject?.id, num], field: 'issue' as const },
      { key: ['issue-votes', currentProject?.id, num], field: 'votes' as const },
      { key: ['issue-watchers', currentProject?.id, num], field: 'watchers' as const },
      { key: ['sprints', currentProject?.id], field: 'sprints' as const },
      { key: ['activity', currentProject?.id, num], field: 'activity' as const },
    ],
    [currentProject?.id, num],
  );

  useEffect(() => {
    if (!hydrationQuery.data) return;
    const hd = hydrationQuery.data;
    for (const { key, field } of hydrationMappings) {
      const value = hd[field];
      if (value !== null && value !== undefined) {
        queryClient.setQueryData(key, value);
      }
    }
    // Seed keys that depend on issue.number / issue.id (not available in mappings)
    if (hd.links !== null && hd.links !== undefined && hd.issue) {
      const issueNum = (hd.issue as { number?: number }).number;
      const issueId = (hd.issue as { id?: string }).id;
      if (issueNum !== undefined) {
        if (hd.links !== null)
          queryClient.setQueryData(['issue-links', currentProject?.id, issueNum], hd.links);
        if (hd.children !== null)
          queryClient.setQueryData(['issue-children', currentProject?.id, issueNum], hd.children);
        if (hd.progress !== null)
          queryClient.setQueryData(['issue-progress', currentProject?.id, issueNum], hd.progress);
        if (hd.development.branches !== null)
          queryClient.setQueryData(
            ['issue-branches', currentProject?.id, issueNum],
            hd.development.branches,
          );
        if (hd.development.pullRequests !== null)
          queryClient.setQueryData(
            ['issue-prs', currentProject?.id, issueNum],
            hd.development.pullRequests,
          );
        if (hd.development.commits !== null)
          queryClient.setQueryData(
            ['issue-commits', currentProject?.id, issueNum],
            hd.development.commits,
          );
      }
      if (issueId && hd.attachments !== null) {
        queryClient.setQueryData(['attachments', issueId], hd.attachments);
      }
    }
    if (hd.worklogs !== null && hd.worklogs !== undefined) {
      queryClient.setQueryData(['worklogs', currentProject?.id, numInt], hd.worklogs);
    }
    if (hd.customFields !== null && hd.customFields !== undefined) {
      queryClient.setQueryData(['custom-fields', currentProject?.id], hd.customFields);
    }
  }, [hydrationQuery.data, hydrationMappings, queryClient, currentProject?.id, numInt]);

  const {
    data: issue,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['issue', currentProject?.id, num],
    queryFn: () => issuesApi.get(currentProject!.id, parseInt(num!)),
    enabled: !!currentProject?.id && !!num,
  });

  const { data: voteData } = useQuery({
    queryKey: ['issue-votes', currentProject?.id, num],
    queryFn: () => issuesApi.getVotes(currentProject!.id, parseInt(num!)),
    enabled:
      !!currentProject?.id &&
      !!num &&
      (hydrationQuery.isError || (hydrationQuery.isSuccess && hydrationQuery.data?.votes === null)),
    staleTime: 30_000,
  });

  const voteMutation = useMutation({
    mutationFn: () => issuesApi.toggleVote(currentProject!.id, parseInt(num!)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-votes', currentProject?.id, num] });
      invalidateAll();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { data: watcherData } = useQuery({
    queryKey: ['issue-watchers', currentProject?.id, num],
    queryFn: () => issuesApi.getWatchers(currentProject!.id, parseInt(num!)),
    enabled:
      !!currentProject?.id &&
      !!num &&
      (hydrationQuery.isError ||
        (hydrationQuery.isSuccess && hydrationQuery.data?.watchers === null)),
    staleTime: 30_000,
  });

  const watchMutation = useMutation({
    mutationFn: () => issuesApi.toggleWatch(currentProject!.id, parseInt(num!)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-watchers', currentProject?.id, num] });
      invalidateAll();
    },
    onError: (err: Error) => toast.error(err.message),
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
    enabled:
      !!currentProject?.id &&
      !!issue?.number &&
      (hydrationQuery.isError || (hydrationQuery.isSuccess && hydrationQuery.data?.links === null)),
    staleTime: 30_000,
  });

  const { data: sprints = [] } = useQuery({
    queryKey: ['sprints', currentProject?.id],
    queryFn: () => sprintsApi.list(currentProject!.id),
    enabled:
      !!currentProject?.id &&
      (hydrationQuery.isError ||
        (hydrationQuery.isSuccess && hydrationQuery.data?.sprints === null)),
    staleTime: 30_000,
  });

  const { data: activityData } = useQuery({
    queryKey: ['activity', currentProject?.id, num],
    queryFn: () => activityApi.listIssueActivity(currentProject!.id, parseInt(num!), { limit: 50 }),
    enabled:
      !!currentProject?.id &&
      !!num &&
      (hydrationQuery.isError ||
        (hydrationQuery.isSuccess && hydrationQuery.data?.activity === null)),
    staleTime: 30_000,
  });

  const { user } = useAuthStore();

  const { data: attachments = [] } = useQuery({
    queryKey: ['attachments', issue?.id],
    queryFn: () => attachmentsApi.list({ issueId: issue!.id }),
    enabled:
      !!issue?.id &&
      (hydrationQuery.isError ||
        (hydrationQuery.isSuccess && hydrationQuery.data?.attachments === null)),
    staleTime: 30_000,
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (id: string) => attachmentsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', issue?.id] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const { data: children = [] } = useQuery({
    queryKey: ['issue-children', currentProject?.id, issue?.number],
    queryFn: () => issuesApi.getChildren(currentProject!.id, issue!.number),
    enabled:
      !!currentProject?.id &&
      !!issue?.number &&
      (hydrationQuery.isError ||
        (hydrationQuery.isSuccess && hydrationQuery.data?.children === null)),
    staleTime: 30_000,
  });

  const { data: progress } = useQuery({
    queryKey: ['issue-progress', currentProject?.id, issue?.number],
    queryFn: () => issuesApi.getProgress(currentProject!.id, issue!.number),
    enabled:
      !!currentProject?.id &&
      !!issue?.number &&
      children.length > 0 &&
      (hydrationQuery.isError ||
        (hydrationQuery.isSuccess && hydrationQuery.data?.progress === null)),
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      issuesApi.update(currentProject!.id, parseInt(num!), data),
    onSuccess: () => {
      invalidateAll();
      titleDraftState.cancel();
      setEditingField(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  useEffect(() => {
    if (titleDraftState.isEditing && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [titleDraftState.isEditing]);

  if (isLoading) return <DetailSkeleton />;
  if (isError) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Failed to load issue"
        description="Something went wrong loading this issue."
      />
    );
  }
  if (!issue) return <div className="text-center py-16 text-text-secondary">Issue not found</div>;

  function startEditTitle() {
    titleDraftState.startEditing(issue!.title);
  }

  function saveTitle() {
    if (titleDraftState.draft.trim() && titleDraftState.draft !== issue!.title) {
      updateMutation.mutate({ title: titleDraftState.draft });
    } else {
      titleDraftState.cancel();
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
              {titleDraftState.isEditing ? (
                <div className="flex items-center gap-2">
                  <Input
                    ref={titleInputRef}
                    value={titleDraftState.draft}
                    onChange={(e) => titleDraftState.setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTitle();
                      if (e.key === 'Escape') titleDraftState.cancel();
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
                    onClick={() => titleDraftState.cancel()}
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
            {bodyDraftState.isEditing ? (
              <div className="space-y-2">
                <MarkdownEditor
                  value={bodyDraftState.draft}
                  onChange={bodyDraftState.setDraft}
                  projectId={currentProject?.id}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      updateMutation.mutate({ body: bodyDraftState.draft });
                      bodyDraftState.reset();
                    }}
                  >
                    <Check className="h-4 w-4" /> Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => bodyDraftState.cancel()}>
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
                  onClick={() => bodyDraftState.startEditing(issue.body ?? '')}
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
              {attachments.length > 0 && <Badge size="sm">{attachments.length}</Badge>}
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
            onCommentReset={resetComment}
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
