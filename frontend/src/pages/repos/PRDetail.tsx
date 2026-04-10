import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useParams } from 'react-router';

import { PRDiffView } from './PRDiffView';
import { PRHeader } from './PRHeader';
import { PRReviewPanel } from './PRReviewPanel';
import { PRTimeline } from './PRTimeline';

import { hydrateApi } from '@/api/hydrate.api';
import { reposApi } from '@/api/repos.api';
import { statusChecksApi } from '@/api/status-checks.api';
import { DetailSkeleton } from '@/components/ui/Skeleton';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { usePRInvalidation } from '@/hooks/usePRInvalidation';
import { useRepoContext } from '@/hooks/useRepoContext';
import { useAuthStore } from '@/stores/auth.store';

/**
 *
 */
export default function PRDetail() {
  const { org, teamSlug, repoSlug, currentRepo } = useRepoContext();
  const { number: prNum } = useParams();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState('');
  const [mergeStrategy, setMergeStrategy] = useState('');
  const [deleteSourceBranch, setDeleteSourceBranch] = useState(() => {
    return localStorage.getItem('pr-delete-branch-preference') === 'true';
  });
  const [diffView, setDiffView] = useState<'unified' | 'split'>('unified');
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [applyingComment, setApplyingComment] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionBody, setDescriptionBody] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentBody, setEditCommentBody] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { user } = useAuthStore();

  const toggleSuggestion = useCallback((commentId: string) => {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  }, []);

  const prNumber = parseInt(prNum!);
  const { invalidatePR } = usePRInvalidation(currentRepo?.id ?? '', prNumber);

  // Hydration: single request for all PR detail data
  const hydrationQuery = useQuery({
    queryKey: ['pr-hydrate', currentRepo?.id, prNumber],
    queryFn: () => hydrateApi.prDetail(currentRepo!.id, prNumber),
    enabled: !!currentRepo?.id,
    retry: 1,
    staleTime: 30_000,
  });

  // Seed individual caches from hydration response
  const hydrationMappings = useMemo(
    () => [
      { key: ['pr', currentRepo?.id, prNumber], field: 'pr' as const },
      { key: ['mergeChecks', currentRepo?.id, prNumber], field: 'mergeChecks' as const },
      { key: ['prCommits', currentRepo?.id, prNumber], field: 'commits' as const },
    ],
    [currentRepo?.id, prNumber],
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
    // Seed diff data (stats + raw diff text)
    if (hd.diff !== null && hd.diff !== undefined) {
      queryClient.setQueryData(['prDiff', currentRepo?.id, prNumber], hd.diff);
    }
  }, [hydrationQuery.data, hydrationMappings, queryClient, currentRepo?.id, prNumber]);

  const {
    data: pr,
    isLoading,
    error: prError,
  } = useQuery({
    queryKey: ['pr', currentRepo?.id, prNumber],
    queryFn: () => reposApi.getPR(currentRepo!.id, prNumber),
    enabled:
      !!currentRepo?.id &&
      (hydrationQuery.isError || (hydrationQuery.isSuccess && hydrationQuery.data?.pr === null)),
  });

  const { data: mergeChecks } = useQuery({
    queryKey: ['mergeChecks', currentRepo?.id, prNumber],
    queryFn: () => reposApi.getMergeChecks(currentRepo!.id, prNumber),
    enabled:
      !!currentRepo?.id &&
      (hydrationQuery.isError ||
        (hydrationQuery.isSuccess && hydrationQuery.data?.mergeChecks === null)),
  });

  if (mergeChecks && mergeStrategy === '') {
    setMergeStrategy(mergeChecks.defaultStrategy.toLowerCase());
  }

  const { data: diff } = useQuery({
    queryKey: ['prDiff', currentRepo?.id, prNumber],
    queryFn: () => reposApi.getPRDiff(currentRepo!.id, prNumber),
    enabled:
      !!currentRepo?.id &&
      (hydrationQuery.isError || (hydrationQuery.isSuccess && hydrationQuery.data?.diff === null)),
  });

  const { data: commits } = useQuery({
    queryKey: ['prCommits', currentRepo?.id, prNumber],
    queryFn: () => reposApi.getPRCommits(currentRepo!.id, prNumber),
    enabled:
      !!currentRepo?.id &&
      (hydrationQuery.isError ||
        (hydrationQuery.isSuccess && hydrationQuery.data?.commits === null)),
  });

  const { data: prStatuses } = useQuery({
    queryKey: ['prStatuses', currentRepo?.id, prNumber],
    queryFn: () => statusChecksApi.getPRStatuses(currentRepo!.id, prNumber),
    enabled: !!currentRepo?.id && pr?.status === 'OPEN',
  });

  const { data: codeOwners } = useQuery({
    queryKey: ['prCodeOwners', currentRepo?.id, prNumber],
    queryFn: () => statusChecksApi.getPRCodeOwners(currentRepo!.id, prNumber),
    enabled: !!currentRepo?.id,
  });

  const mergeMutation = useMutationWithToast(
    () =>
      reposApi.mergePR(currentRepo!.id, prNumber, { strategy: mergeStrategy, deleteSourceBranch }),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['pr', currentRepo?.id, prNumber]],
    },
  );

  const closeMutation = useMutationWithToast(() => reposApi.closePR(currentRepo!.id, prNumber), {
    successMessage: null,
    errorMessage: null,
    invalidateKeys: [['pr', currentRepo?.id, prNumber]],
  });

  const reviewMutation = useMutationWithToast(
    (data: { status: string; body?: string }) =>
      reposApi.submitReview(currentRepo!.id, prNumber, data),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['pr', currentRepo?.id, prNumber]],
    },
  );

  const commentMutation = useMutationWithToast(
    () => reposApi.addPRComment(currentRepo!.id, prNumber, { body: commentBody }),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['pr', currentRepo?.id, prNumber]],
      onSuccess: () => setCommentBody(''),
    },
  );

  const replyMutation = useMutationWithToast(
    ({ parentId, body }: { parentId: string; body: string }) =>
      reposApi.addPRComment(currentRepo!.id, prNumber, { body, parentId }),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['pr', currentRepo?.id, prNumber]],
    },
  );

  const applySuggestionMutation = useMutation({
    mutationFn: (commentId: string) =>
      reposApi.applySuggestion(currentRepo!.id, prNumber, commentId),
    onMutate: (commentId) => setApplyingComment(commentId),
    onSettled: () => setApplyingComment(null),
    onSuccess: () => {
      invalidatePR();
    },
  });

  const batchApplyMutation = useMutationWithToast(
    () => reposApi.batchApplySuggestions(currentRepo!.id, prNumber, [...selectedSuggestions]),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [
        ['pr', currentRepo?.id, prNumber],
        ['prDiff', currentRepo?.id, prNumber],
        ['prCommits', currentRepo?.id, prNumber],
      ],
      onSuccess: () => setSelectedSuggestions(new Set()),
    },
  );

  const updateDescriptionMutation = useMutationWithToast(
    (body: string) => reposApi.updatePR(currentRepo!.id, prNumber, { body }),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['pr', currentRepo?.id, prNumber]],
      onSuccess: () => setEditingDescription(false),
    },
  );

  const updateCommentMutation = useMutationWithToast(
    ({ commentId, body }: { commentId: string; body: string }) =>
      reposApi.updatePRComment(currentRepo!.id, commentId, body),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['pr', currentRepo?.id, prNumber]],
      onSuccess: () => setEditingCommentId(null),
    },
  );

  const deleteCommentMutation = useMutationWithToast(
    (commentId: string) => reposApi.deletePRComment(currentRepo!.id, commentId),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['pr', currentRepo?.id, prNumber]],
    },
  );

  if (isLoading || !pr) return <DetailSkeleton />;

  if (prError || hydrationQuery.error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load pull request</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PRHeader
        pr={pr}
        org={org!}
        teamSlug={teamSlug!}
        repoSlug={repoSlug!}
        editingDescription={editingDescription}
        descriptionBody={descriptionBody}
        onDescriptionBodyChange={setDescriptionBody}
        onEditDescription={() => {
          setDescriptionBody(pr.body ?? '');
          setEditingDescription(true);
        }}
        onSaveDescription={() => updateDescriptionMutation.mutate(descriptionBody)}
        onCancelEditDescription={() => setEditingDescription(false)}
        isSavingDescription={updateDescriptionMutation.isPending}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        {/* Main content */}
        <div className="flex flex-col gap-6">
          <PRDiffView
            commits={commits}
            diff={diff}
            diffView={diffView}
            onDiffViewChange={setDiffView}
            repoId={currentRepo?.id}
            prNumber={prNumber}
          />

          <PRTimeline
            pr={pr}
            userId={user?.id}
            editingCommentId={editingCommentId}
            editCommentBody={editCommentBody}
            onEditCommentBodyChange={setEditCommentBody}
            onStartEditComment={(id, body) => {
              setEditCommentBody(body);
              setEditingCommentId(id);
            }}
            onSaveEditComment={(id) =>
              updateCommentMutation.mutate({ commentId: id, body: editCommentBody })
            }
            onCancelEditComment={() => setEditingCommentId(null)}
            isSavingComment={updateCommentMutation.isPending}
            deleteTarget={deleteTarget}
            onSetDeleteTarget={setDeleteTarget}
            onDeleteComment={(id) => deleteCommentMutation.mutate(id)}
            selectedSuggestions={selectedSuggestions}
            applyingComment={applyingComment}
            onApplySuggestion={(id) => applySuggestionMutation.mutate(id)}
            onToggleSuggestion={toggleSuggestion}
            onBatchApply={() => batchApplyMutation.mutate()}
            isBatchApplying={batchApplyMutation.isPending}
            commentBody={commentBody}
            onCommentBodyChange={setCommentBody}
            onSubmitComment={() => commentMutation.mutate()}
            isSubmittingComment={commentMutation.isPending}
            onSubmitReply={(parentId, body) => replyMutation.mutate({ parentId, body })}
            isSubmittingReply={replyMutation.isPending}
            onApprove={() => reviewMutation.mutate({ status: 'APPROVED', body: 'LGTM' })}
            onRequestChanges={() =>
              reviewMutation.mutate({
                status: 'CHANGES_REQUESTED',
                body: 'Please address feedback',
              })
            }
          />
        </div>

        {/* Sidebar */}
        <PRReviewPanel
          pr={pr}
          org={org!}
          teamSlug={teamSlug!}
          repoSlug={repoSlug!}
          mergeStrategy={mergeStrategy}
          onSetMergeStrategy={setMergeStrategy}
          mergeChecks={mergeChecks}
          prStatuses={prStatuses}
          codeOwners={codeOwners}
          onMerge={() => mergeMutation.mutate()}
          isMerging={mergeMutation.isPending}
          mergeError={mergeMutation.isError ? mergeMutation.error : null}
          onClose={() => closeMutation.mutate()}
          deleteSourceBranch={deleteSourceBranch}
          onSetDeleteSourceBranch={setDeleteSourceBranch}
          defaultBranch={currentRepo?.defaultBranch}
        />
      </div>
    </div>
  );
}
