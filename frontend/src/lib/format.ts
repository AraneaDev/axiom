/**
 * Format a byte count into a human-readable string.
 * Handles B, KB, MB, GB, TB.
 * @param bytes
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Format an ISO date string as a localized date+time string.
 * e.g. "Mar 30, 2026, 2:15:30 PM"
 * @param ts
 */
export function formatTimestamp(ts: string | Date): string {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
