/** 409 error codes from `POST merge` (src/modules/wiki/page-merge.ts) */
export const MERGE_STALE = 'MERGE_STALE';
export const MERGE_IN_PROGRESS = 'MERGE_IN_PROGRESS';
export const MERGE_REBASE_CONFLICT = 'MERGE_REBASE_CONFLICT';

/**
 * The "ours" side as it reads inside a sentence: "yours", or a name such as "Sam's session".
 * @param oursLabel - The label from the pending merge
 */
export function oursPhrase(oursLabel: string): string {
  return oursLabel.toLowerCase() === 'yours' ? 'yours' : oursLabel;
}

/**
 * The counts line, e.g. "2 changes merge cleanly, 1 overlaps with yours".
 * @param clean
 * @param conflicts
 * @param oursLabel - The label of the side the change is merged into
 */
export function countsText(clean: number, conflicts: number, oursLabel = 'Yours'): string {
  const ours = oursPhrase(oursLabel);
  const cleanPart = clean === 1 ? '1 change merges cleanly' : `${clean} changes merge cleanly`;
  const overlapPart =
    conflicts === 1 ? `1 overlaps with ${ours}` : `${conflicts} overlap with ${ours}`;
  return `${cleanPart}, ${overlapPart}`;
}

/**
 * The status and code of an api error.
 * @param err
 */
export function errorInfo(err: unknown): { status?: number; code?: string } {
  const e = err as { status?: number; code?: string } | null;
  return { status: e?.status, code: e?.code };
}

/**
 * The toast for a rejected merge that is a 409, or null for any other error.
 * @param err
 * @returns The text and whether the pending merge should be reloaded
 */
export function mergeConflictNotice(err: unknown): { text: string; reload: boolean } | null {
  const { status, code } = errorInfo(err);
  if (status !== 409) return null;
  if (code === MERGE_IN_PROGRESS)
    return { text: 'Someone else is merging this page', reload: false };
  return { text: 'This page changed again', reload: true };
}
