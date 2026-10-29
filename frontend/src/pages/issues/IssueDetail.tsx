import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MessageSquare, Paperclip, ShieldCheck } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router';

import { activityApi } from '@/api/activity.api';
import { attachmentsApi } from '@/api/attachments.api';
import { hydrateApi } from '@/api/hydrate.api';
import { issuesApi } from '@/api/issues.api';
import { sprintsApi } from '@/api/sprints.api';
import { teamsApi } from '@/api/teams.api';
import { PageLayout } from '@/components/layout/PageLayout';
import { ApprovalPanel } from '@/components/ui/ApprovalPanel';
import { AttachmentList } from '@/components/ui/AttachmentList';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FileUpload } from '@/components/ui/FileUpload';
import { DetailSkeleton } from '@/components/ui/Skeleton';
import { useDraftState } from '@/hooks/useDraftState';
import { useIssueInvalidation } from '@/hooks/useIssueInvalidation';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

import { IssueBodySection } from './IssueBodySection';
import { IssueDetailComments } from './IssueDetailComments';
import { IssueDetailSidebar } from './IssueDetailSidebar';
import { IssueHeader } from './IssueHeader';

/**
 *
 */
export default function IssueDetail() {
  const { org, teamSlug, projectSlug, currentTeam, currentProject } = useProjectContext();
  const { num } = useParams();
  const queryClient = useQueryClient();
  const { draft: commentBody, setDraft: setCommentBody, reset: resetComment } = useDraftState('');
  const titleDraftState = useDraftState('');
  const bodyDraftState = useDraftState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'comments' | 'approvals'>('comments');
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

  const voteMutation = useMutationWithToast(
    () => issuesApi.toggleVote(currentProject!.id, parseInt(num!)),
    {
      successMessage: null,
      invalidateKeys: [['issue-votes', currentProject?.id, num]],
      onSuccess: () => invalidateAll(),
    },
  );

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

  const watchMutation = useMutationWithToast(
    () => issuesApi.toggleWatch(currentProject!.id, parseInt(num!)),
    {
      successMessage: null,
      invalidateKeys: [['issue-watchers', currentProject?.id, num]],
      onSuccess: () => invalidateAll(),
    },
  );

  const { data: teamDetail } = useQuery({
    queryKey: ['team-detail', currentTeam?.id],
    queryFn: () => teamsApi.get(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  const { data: links = [] } = useQuery({
    queryKey: ['issue-links', currentProject?.id, issue?.number],
    queryFn: () => issuesApi.listLinks(currentProject!.id, issue!.number),
    // Enabled once hydration settles so that invalidating this key (after adding a link)
    // refetches; the hydrated links are seeded into the cache and stay fresh via staleTime.
    enabled:
      !!currentProject?.id &&
      !!issue?.number &&
      (hydrationQuery.isError || hydrationQuery.isSuccess),
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

  const deleteAttachmentMutation = useMutationWithToast((id: string) => attachmentsApi.remove(id), {
    successMessage: null,
    invalidateKeys: [['attachments', issue?.id]],
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

  const updateMutation = useMutationWithToast(
    (data: Record<string, unknown>) => issuesApi.update(currentProject!.id, parseInt(num!), data),
    {
      successMessage: null,
      onSuccess: () => {
        invalidateAll();
        titleDraftState.cancel();
        setEditingField(null);
      },
    },
  );

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
  if (!issue) return <EmptyState title="Issue not found" />;

  function saveTitle() {
    if (titleDraftState.draft.trim() && titleDraftState.draft !== issue!.title) {
      updateMutation.mutate({ title: titleDraftState.draft });
    } else {
      titleDraftState.cancel();
    }
  }

  const sidebarContent = (
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
      activities={activityData?.activities ?? []}
      editingField={editingField}
      onEditField={setEditingField}
      onUpdate={(data) => updateMutation.mutate(data)}
      isUpdating={updateMutation.isPending}
    />
  );

  return (
    <PageLayout sidebar={sidebarContent} sidebarWidth="w-[340px] 2xl:w-[380px]">
      <div>
        <IssueHeader
          issue={issue}
          titleDraft={titleDraftState.draft}
          isTitleEditing={titleDraftState.isEditing}
          onTitleDraftChange={titleDraftState.setDraft}
          onStartEditTitle={() => titleDraftState.startEditing(issue.title)}
          onSaveTitle={saveTitle}
          onCancelTitle={() => titleDraftState.cancel()}
          voteData={voteData}
          watcherData={watcherData}
          onVote={() => voteMutation.mutate()}
          onWatch={() => watchMutation.mutate()}
        />

        <IssueBodySection
          body={issue.body}
          basePath={`/${org}/${teamSlug}/${projectSlug}`}
          projectId={currentProject?.id}
          isEditing={bodyDraftState.isEditing}
          draft={bodyDraftState.draft}
          onDraftChange={bodyDraftState.setDraft}
          onStartEdit={() => bodyDraftState.startEditing(issue.body ?? '')}
          onSave={() => {
            updateMutation.mutate({ body: bodyDraftState.draft });
            bodyDraftState.reset();
          }}
          onCancel={() => bodyDraftState.cancel()}
        />

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
            onUpload={() => queryClient.invalidateQueries({ queryKey: ['attachments', issue.id] })}
          />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab('comments')}
            className={cn(
              'rounded-none border-b-2 px-3 py-2',
              activeTab === 'comments'
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-text-secondary hover:text-text',
            )}
          >
            <MessageSquare className="h-4 w-4" />
            Comments
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab('approvals')}
            className={cn(
              'rounded-none border-b-2 px-3 py-2',
              activeTab === 'approvals'
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-text-secondary hover:text-text',
            )}
          >
            <ShieldCheck className="h-4 w-4" />
            Approvals
          </Button>
        </div>

        {/* Tab content */}
        {activeTab === 'comments' && (
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
        )}

        {activeTab === 'approvals' && <ApprovalPanel issueId={issue.id} />}
      </div>
    </PageLayout>
  );
}
