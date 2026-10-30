import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, CircleCheck, GitMerge, Save, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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

import { countsText, mergeConflictNotice, oursPhrase } from './merge-copy';

type Conflict = Extract<MergeHunk, { kind: 'conflict' }>;

/** Results chosen so far, keyed by conflict signature (see `signatures`) */
type Choices = Record<string, string>;

/**
 * A short, stable hash of some texts (FNV-1a), to tell loaded data and conflicts apart.
 * @param parts
 */
function hashTexts(...parts: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of parts.join('\u0000')) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * A signature per conflict that survives a reload: its content plus which occurrence of that
 * content it is, so a conflict that did not change keeps its result.
 * @param conflicts
 * @returns conflict id to signature
 */
function signatures(conflicts: Conflict[]): Record<string, string> {
  const seen: Record<string, number> = {};
  const out: Record<string, string> = {};
  for (const c of conflicts) {
    const content = hashTexts(c.base, c.ours, c.theirs);
    seen[content] = (seen[content] ?? 0) + 1;
    out[c.id] = `${content}#${seen[content]}`;
  }
  return out;
}

interface ConflictViewProps {
  spaceId: string;
  pageSlug: string;
  /** The pending change being merged */
  externalVersionId: string;
  /** Close the view (after finishing, cancelling, or when nothing is left to merge) */
  onClose: () => void;
  /** Set while someone applies a merge: Finish merge waits for it */
  locked?: { byName: string } | null;
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
  /** Results chosen so far; kept by the parent so a reload keeps them for unchanged conflicts */
  choices: Choices;
  /** Set (or with undefined, clear) the result for a conflict signature */
  onChoose: (signature: string, text: string | undefined) => void;
}

/**
 * The conflict list and resolver for one loaded pending merge. Remounted only when the loaded
 * data changes; the choices live in the parent, keyed by conflict content.
 * @param props
 * @param props.spaceId
 * @param props.pageSlug
 * @param props.onClose
 * @param props.pending
 * @param props.merge
 * @param props.choices
 * @param props.onChoose
 * @param props.locked
 */
function Resolver({
  spaceId,
  pageSlug,
  onClose,
  pending,
  merge,
  choices,
  onChoose,
  locked = null,
}: ResolverProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const conflicts = merge.hunks.filter((h): h is Conflict => h.kind === 'conflict');
  const sigs = signatures(conflicts);
  const [selectedId, setSelectedId] = useState<string | null>(conflicts[0]?.id ?? null);
  const selected = conflicts.find((c) => c.id === selectedId) ?? null;
  const isResolved = (id: string) => Object.prototype.hasOwnProperty.call(choices, sigs[id]);
  const resultOf = (id: string) => (isResolved(id) ? choices[sigs[id]] : undefined);
  const resolvedCount = conflicts.filter((c) => isResolved(c.id)).length;
  const allResolved = resolvedCount === conflicts.length;

  const finish = useMutationWithToast(
    () => {
      const byId: Record<string, string> = {};
      for (const c of conflicts) {
        const text = resultOf(c.id);
        if (text !== undefined) byId[c.id] = text;
      }
      return wikiApi.applyMerge(spaceId, pageSlug, {
        externalVersionId: pending.externalVersionId,
        markdown: merge.merged ?? resolveMerge(merge.hunks, byId),
        ours: pending.ours,
      });
    },
    {
      successMessage: null,
      errorMessage: null,
      onSuccess: onClose,
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
    },
  );

  const choose = (id: string, text: string) => onChoose(sigs[id], text);
  // Typing into the result is a choice; clearing it again is not, so an empty box stays Open
  const edit = (id: string, text: string) => onChoose(sigs[id], text === '' ? undefined : text);

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <GitMerge className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-text">
            Merge {pending.oursLabel} with {pending.theirsLabel}
          </h2>
          <p className="text-xs text-text-secondary">
            {countsText(merge.counts.clean, merge.counts.conflicts, pending.oursLabel)}
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
          disabled={!allResolved || !!locked || finish.isPending}
        >
          {finish.isPending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Finish
          merge
        </Button>
      </div>

      {conflicts.length === 0 ? (
        <div className="space-y-3 p-4">
          <p className="text-sm text-text-secondary">
            No overlapping changes. Finish merge applies the changes from {pending.theirsLabel} on
            top of {oursPhrase(pending.oursLabel)}.
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
              const resolved = isResolved(c.id);
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
                  chosen={resultOf(selected.id) === selected.ours}
                  onUse={() => choose(selected.id, selected.ours)}
                />
                <SideCard
                  label={pending.theirsLabel}
                  text={selected.theirs}
                  chosen={resultOf(selected.id) === selected.theirs}
                  onUse={() => choose(selected.id, selected.theirs)}
                />
              </div>
              <Textarea
                label="Result"
                rows={8}
                className="font-mono text-xs"
                value={resultOf(selected.id) ?? ''}
                onChange={(e) => edit(selected.id, e.target.value)}
                placeholder="Pick a side above or write the result here"
                hint={
                  resultOf(selected.id) === ''
                    ? 'This passage will be removed.'
                    : 'To drop this passage from the page, use Remove passage.'
                }
              />
              <div className="flex justify-end">
                <Button
                  variant={resultOf(selected.id) === '' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => choose(selected.id, '')}
                >
                  <Trash2 className="h-4 w-4" /> Remove passage
                </Button>
              </div>
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
 * @param props.locked
 */
export function ConflictView(props: ConflictViewProps) {
  const { spaceId, pageSlug, externalVersionId, onClose } = props;
  const { query, pending, merge } = usePendingMerge(spaceId, pageSlug, externalVersionId);
  const [choices, setChoices] = useState<Choices>({});
  const onChoose = (signature: string, text: string | undefined) =>
    setChoices((prev) => {
      const next = { ...prev };
      if (text === undefined) delete next[signature];
      else next[signature] = text;
      return next;
    });
  // The resolver is remounted when the loaded data changes, not on every refetch
  const dataKey = useMemo(
    () =>
      pending
        ? `${pending.externalVersionId}:${hashTexts(pending.base, pending.ours, pending.theirs)}`
        : '',
    [pending],
  );

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

  return (
    <Resolver
      key={dataKey}
      {...props}
      pending={pending}
      merge={merge}
      choices={choices}
      onChoose={onChoose}
    />
  );
}
