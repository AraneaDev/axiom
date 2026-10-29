/**
 * The counts line, e.g. "2 changes merge cleanly, 1 overlaps with yours".
 * @param clean
 * @param conflicts
 */
export function countsText(clean: number, conflicts: number): string {
  const cleanPart = clean === 1 ? '1 change merges cleanly' : `${clean} changes merge cleanly`;
  const overlapPart = conflicts === 1 ? '1 overlaps with yours' : `${conflicts} overlap with yours`;
  return `${cleanPart}, ${overlapPart}`;
}
