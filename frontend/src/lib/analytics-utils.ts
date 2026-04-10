/**
 * Shared utility functions for analytics pages.
 */

/**
 *
 * @param m
 */
export function formatMinutes(m: number): string {
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 *
 * @param total
 */
export function loadColor(total: number): string {
  if (total >= 8) return 'text-danger';
  if (total >= 5) return 'text-warning';
  return 'text-success';
}

/**
 *
 * @param days
 */
export function ageColor(days: number): string {
  if (days >= 30) return 'text-danger';
  if (days >= 14) return 'text-warning';
  return 'text-text-secondary';
}

export const PRIORITY_TEXT_COLORS: Record<string, string> = {
  CRITICAL: 'text-danger',
  HIGH: 'text-warning',
  MEDIUM: 'text-text',
  LOW: 'text-text-tertiary',
};
