import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Combine, Eye, History, RefreshCw, X } from 'lucide-react';
import { useEffect } from 'react';

import { wikiApi } from '@/api/wiki.api';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import type { PendingChange } from '@/hooks/collab-messages';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { pendingMergeKey, usePendingMerge } from '@/hooks/usePendingMerge';
import { cn, formatDate, formatRelative } from '@/lib/utils';

import { countsText } from './merge-copy';

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
 * @param props.onOpenConflicts
 * @param props.onDismissResolved
 */
export function ExternalChangeBanner({
  spaceId,
  pageSlug,
  pendingChange,
  resolvedBy,
  canEdit,
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

  const mergeMutation = useMutationWithToast(
    (markdown: string) =>
      wikiApi.applyMerge(spaceId, pageSlug, {
        externalVersionId: pending!.externalVersionId,
        markdown,
      }),
    {
      successMessage: null,
      errorMessage: null,
      onError: (err) => {
        if ((err as { status?: number }).status === 409) {
          toast.info('This page changed again');
          void queryClient.invalidateQueries({ queryKey: pendingMergeKey(spaceId, pageSlug) });
        } else {
          toast.error(err.message || 'Merge failed');
        }
      },
    },
  );

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
              ? countsText(merge.counts.clean, merge.counts.conflicts)
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
          <Button variant="secondary" size="sm" onClick={onOpenConflicts} disabled={!merge}>
            <Eye className="h-4 w-4" /> Review changes
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={mergeNow}
            disabled={!merge || mergeMutation.isPending}
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
