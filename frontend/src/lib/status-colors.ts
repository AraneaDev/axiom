/**
 * Map a status string to Tailwind color classes for badges/pills.
 * @param status
 */
export function statusColorClass(status: string): string {
  const s = status.toUpperCase();
  if (s === 'OPEN' || s === 'IN PROGRESS' || s === 'TO DO') return 'bg-primary/15 text-primary';
  if (s === 'MERGED' || s === 'DONE' || s === 'PUBLISHED') return 'bg-success/15 text-success';
  if (s === 'CLOSED' || s === 'DRAFT') return 'bg-muted text-muted-foreground';
  return 'bg-muted text-muted-foreground';
}
