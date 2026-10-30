import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Combine, Eye, History, RefreshCw, X } from 'lucide-react';
import { useEffect } from 'react';

import { wikiApi } from '@/api/wiki.api';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import type { PendingChange } from '@/hooks/collab-messages';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import {
  computeMerge,
  pendingMergeKey,
  pendingMergeQueryKey,
  usePendingMerge,
} from '@/hooks/usePendingMerge';
import type { PendingMerge } from '@/lib/types';
import { cn, formatDate, formatRelative } from '@/lib/utils';

import { countsText, errorInfo, MERGE_REBASE_CONFLICT, mergeConflictNotice } from './merge-copy';

/** How long the "Merged by" note stays before it closes itself */
const RESOLVED_NOTE_MS = 6000;

interface ExternalChangeBannerProps {
  spaceId: string;
  pageSlug: string;
  /** The pending external change from the collaboration session */
  pendingChange: PendingChange | null;
  /** Who merged the change, once the session reports it */
  resolvedBy: string | null;
  /** Whether the user may merge (viewers see the notice only) */
  canEdit: boolean;
  /** Set while someone applies a merge: the merge actions wait for it */
  locked?: { byName: string } | null;
  /** Open the conflict view */
  onOpenConflicts: () => void;
  /** Close the "Merged by" note */
  onDismissResolved?: () => void;
}

/**
 * The notice headline for a pending change.
 * @param change
 */
function headline(change: PendingChange): string {
  if (change.draftAuthorName && change.draftAt) {
    return `Unmerged edits from ${change.draftAuthorName}'s session on ${formatDate(change.draftAt)}`;
  }
  if (change.kind === 'RESTORE') {
    return change.restoredVersion
      ? `${change.authorName} restored version ${change.restoredVersion}`
      : `${change.authorName} restored an earlier version`;
  }
  return `${change.authorName} updated this page ${formatRelative(change.at)}`;
}

/**
 * Notice in the wiki editor that an agent, API call or restore changed the page while it was open,
 * with the merge actions for editors. After a merge it briefly shows who merged.
 * @param props
 * @param props.spaceId
 * @param props.pageSlug
 * @param props.pendingChange
 * @param props.resolvedBy
 * @param props.canEdit
 * @param props.locked
 * @param props.onOpenConflicts
 * @param props.onDismissResolved
 */
export function ExternalChangeBanner({
  spaceId,
  pageSlug,
  pendingChange,
  resolvedBy,
  canEdit,
  locked = null,
  onOpenConflicts,
  onDismissResolved,
}: ExternalChangeBannerProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { pending, merge, query } = usePendingMerge(
    spaceId,
    pageSlug,
    pendingChange?.externalVersionId,
    canEdit && !!pendingChange,
  );

  const post = (data: PendingMerge, markdown: string) =>
    wikiApi.applyMerge(spaceId, pageSlug, {
      externalVersionId: data.externalVersionId,
      markdown,
      ours: data.ours,
    });

  /**
   * Post the clean merge. When the session moved on since the fetch and the server cannot rebase
   * onto it, refetch and try once more; a merge that now overlaps goes to the conflict view.
   * @param markdown
   * @returns Whether the conflict view has to take over
   */
  async function mergeWithRetry(markdown: string): Promise<'merged' | 'conflicts'> {
    try {
      await post(pending!, markdown);
      return 'merged';
    } catch (err) {
      if (errorInfo(err).code !== MERGE_REBASE_CONFLICT) throw err;
    }
    const fresh = await queryClient.fetchQuery({
      queryKey: pendingMergeQueryKey(spaceId, pageSlug, pending!.externalVersionId),
      queryFn: () => wikiApi.getPendingMerge(spaceId, pageSlug),
      staleTime: 0,
    });
    if (!fresh) return 'merged';
    const again = computeMerge(fresh);
    if (again.merged === null) return 'conflicts';
    await post(fresh, again.merged);
    return 'merged';
  }

  const mergeMutation = useMutationWithToast(mergeWithRetry, {
    successMessage: null,
    errorMessage: null,
    onSuccess: (outcome) => {
      if (outcome === 'conflicts') onOpenConflicts();
    },
    onError: (err) => {
      const notice = mergeConflictNotice(err);
      if (notice) {
        toast.info(notice.text);
        if (notice.reload) {
          void queryClient.invalidateQueries({ queryKey: pendingMergeKey(spaceId, pageSlug) });
        }
      } else {
        toast.error(err.message || 'Merge failed');
      }
    },
  });

  useEffect(() => {
    if (!resolvedBy || pendingChange || !onDismissResolved) return;
    const timer = setTimeout(onDismissResolved, RESOLVED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [resolvedBy, pendingChange, onDismissResolved]);

  if (!pendingChange) {
    if (!resolvedBy) return null;
    return (
      <div
        role="status"
        className="mb-4 flex items-center gap-3 rounded-lg border border-success/20 bg-success-light px-4 py-3 text-sm text-success"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span className="flex-1 font-medium">Merged by {resolvedBy}</span>
        {onDismissResolved && (
          <Button variant="ghost" size="xs" onClick={onDismissResolved} title="Dismiss">
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  const isDraft = !!pendingChange.draftAuthorName;
  const Icon = isDraft ? History : RefreshCw;

  function mergeNow() {
    if (!merge) return;
    if (merge.merged !== null) mergeMutation.mutate(merge.merged);
    else onOpenConflicts();
  }

  return (
    <div
      role="status"
      className={cn(
        'mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3',
        isDraft ? 'border-warning/30 bg-warning-light' : 'border-primary/20 bg-primary-light',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', isDraft ? 'text-warning' : 'text-primary')} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text">{headline(pendingChange)}</p>
        {canEdit && (
          <p className="text-xs text-text-secondary">
            {merge
              ? countsText(merge.counts.clean, merge.counts.conflicts, pending?.oursLabel)
              : query.isError
                ? 'Could not load the changes'
                : 'Comparing with your version...'}
          </p>
        )}
        {!canEdit && (
          <p className="text-xs text-text-secondary">An editor of this page can merge it.</p>
        )}
      </div>
      {canEdit && (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenConflicts}
            disabled={!merge || !!locked}
          >
            <Eye className="h-4 w-4" /> Review changes
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={mergeNow}
            disabled={!merge || !!locked || mergeMutation.isPending}
          >
            {mergeMutation.isPending ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <Combine className="h-4 w-4" />
            )}{' '}
            Merge now
          </Button>
        </div>
      )}
    </div>
  );
}
