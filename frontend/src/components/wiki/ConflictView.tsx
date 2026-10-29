import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, CircleCheck, GitMerge, Save, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { wikiApi } from '@/api/wiki.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { resolveMerge, type MergeHunk } from '@/editor-core/merge';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { pendingMergeKey, usePendingMerge, type ComputedMerge } from '@/hooks/usePendingMerge';
import type { PendingMerge } from '@/lib/types';
import { cn } from '@/lib/utils';

import { countsText } from './merge-copy';

type Conflict = Extract<MergeHunk, { kind: 'conflict' }>;

interface ConflictViewProps {
  spaceId: string;
  pageSlug: string;
  /** The pending change being merged */
  externalVersionId: string;
  /** Close the view (after finishing, cancelling, or when nothing is left to merge) */
  onClose: () => void;
}

/**
 * First non-empty line of a passage, for the conflict list.
 * @param text
 */
function preview(text: string): string {
  return text.split('\n').find((l) => l.trim() !== '') ?? '(removed)';
}

interface SideCardProps {
  label: string;
  text: string;
  onUse?: () => void;
  chosen?: boolean;
}

/**
 * One side of a conflict (or of the whole page) with its "Use" action.
 * @param props
 * @param props.label
 * @param props.text
 * @param props.onUse
 * @param props.chosen
 */
function SideCard({ label, text, onUse, chosen }: SideCardProps) {
  return (
    <Card className={cn('flex min-w-0 flex-col overflow-hidden', chosen && 'border-primary/50')}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-secondary px-3 py-2">
        <span className="truncate text-sm font-medium text-text">{label}</span>
        {onUse && (
          <Button
            variant={chosen ? 'primary' : 'secondary'}
            size="xs"
            onClick={onUse}
            aria-label={`Use ${label}`}
          >
            <Check className="h-3.5 w-3.5" /> Use
          </Button>
        )}
      </div>
      <pre className="max-h-80 min-h-[6rem] overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs text-text">
        {text === '' ? <span className="italic text-text-tertiary">(removed)</span> : text}
      </pre>
    </Card>
  );
}

interface ResolverProps extends ConflictViewProps {
  pending: PendingMerge;
  merge: ComputedMerge;
}

/**
 * The conflict list and resolver for one loaded pending merge. Remounted on reload, so choices
 * never carry over to a different set of conflicts.
 * @param props
 * @param props.spaceId
 * @param props.pageSlug
 * @param props.onClose
 * @param props.pending
 * @param props.merge
 */
function Resolver({ spaceId, pageSlug, onClose, pending, merge }: ResolverProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const conflicts = merge.hunks.filter((h): h is Conflict => h.kind === 'conflict');
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(conflicts[0]?.id ?? null);
  const selected = conflicts.find((c) => c.id === selectedId) ?? null;
  const resolvedCount = conflicts.filter((c) => c.id in choices).length;
  const allResolved = resolvedCount === conflicts.length;

  const finish = useMutationWithToast(
    () =>
      wikiApi.applyMerge(spaceId, pageSlug, {
        externalVersionId: pending.externalVersionId,
        markdown: merge.merged ?? resolveMerge(merge.hunks, choices),
      }),
    {
      successMessage: null,
      errorMessage: null,
      onSuccess: onClose,
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

  const choose = (id: string, text: string) => setChoices((prev) => ({ ...prev, [id]: text }));

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <GitMerge className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-text">
            Merge {pending.oursLabel} with {pending.theirsLabel}
          </h2>
          <p className="text-xs text-text-secondary">
            {countsText(merge.counts.clean, merge.counts.conflicts)}
            {conflicts.length > 0 && `. ${resolvedCount} of ${conflicts.length} resolved`}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onClose}>
          <X className="h-4 w-4" /> Close
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => finish.mutate()}
          disabled={!allResolved || finish.isPending}
        >
          {finish.isPending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Finish
          merge
        </Button>
      </div>

      {conflicts.length === 0 ? (
        <div className="space-y-3 p-4">
          <p className="text-sm text-text-secondary">
            No overlapping changes. Finish merge applies the changes from {pending.theirsLabel} on
            top of {pending.oursLabel.toLowerCase() === 'yours' ? 'yours' : pending.oursLabel}.
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SideCard label={pending.oursLabel} text={pending.ours} />
            <SideCard label={pending.theirsLabel} text={pending.theirs} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-4 lg:flex-row">
          <ul
            aria-label="Conflicts"
            className="shrink-0 self-start overflow-hidden rounded-lg border border-border bg-surface divide-y divide-border lg:w-72"
          >
            {conflicts.map((c, i) => {
              const resolved = c.id in choices;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    aria-current={c.id === selectedId}
                    className={cn(
                      'flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-surface-secondary',
                      c.id === selectedId && 'bg-surface-secondary',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium text-text">
                        {resolved ? (
                          <CircleCheck className="h-4 w-4 text-success" />
                        ) : (
                          <CircleAlert className="h-4 w-4 text-warning" />
                        )}
                        Conflict {i + 1}
                      </span>
                      <Badge size="sm" variant={resolved ? 'success' : 'warning'}>
                        {resolved ? 'Resolved' : 'Open'}
                      </Badge>
                    </span>
                    <span className="truncate text-xs text-text-secondary">
                      {preview(c.base || c.ours || c.theirs)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected && (
            <div className="min-w-0 flex-1 space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <SideCard
                  label={pending.oursLabel}
                  text={selected.ours}
                  chosen={choices[selected.id] === selected.ours && selected.id in choices}
                  onUse={() => choose(selected.id, selected.ours)}
                />
                <SideCard
                  label={pending.theirsLabel}
                  text={selected.theirs}
                  chosen={choices[selected.id] === selected.theirs && selected.id in choices}
                  onUse={() => choose(selected.id, selected.theirs)}
                />
              </div>
              <Textarea
                label="Result"
                rows={8}
                className="font-mono text-xs"
                value={choices[selected.id] ?? ''}
                onChange={(e) => choose(selected.id, e.target.value)}
                placeholder="Pick a side above or write the result here"
                hint="An empty result removes this passage."
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Per-conflict merge view (layout B): the conflicts on the left; for the selected one, both sides
 * with a "Use" action and an editable result below. "Finish merge" stays disabled until every
 * conflict has a result.
 * @param props
 * @param props.spaceId
 * @param props.pageSlug
 * @param props.externalVersionId
 * @param props.onClose
 */
export function ConflictView(props: ConflictViewProps) {
  const { spaceId, pageSlug, externalVersionId, onClose } = props;
  const { query, pending, merge } = usePendingMerge(spaceId, pageSlug, externalVersionId);

  // Merged already (by someone else) or withdrawn: nothing left to resolve
  const nothingPending = query.isSuccess && !query.isFetching && query.data === null;
  useEffect(() => {
    if (nothingPending) onClose();
  }, [nothingPending, onClose]);

  if (!pending || !merge) {
    return (
      <Card className="mb-4 flex items-center gap-2 p-4 text-sm text-text-secondary">
        {query.isError ? (
          'Could not load the changes.'
        ) : (
          <>
            <Spinner className="h-4 w-4" /> Loading the changes...
          </>
        )}
      </Card>
    );
  }

  return <Resolver key={query.dataUpdatedAt} {...props} pending={pending} merge={merge} />;
}
