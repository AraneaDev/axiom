export type Period = '7d' | '30d' | '90d' | 'quarter';

/**
 *
 * @param period
 */
export function resolvePeriodStart(period: Period): Date {
  const now = new Date();
  switch (period) {
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case 'quarter': {
      const quarter = Math.floor(now.getMonth() / 3);
      return new Date(now.getFullYear(), quarter * 3, 1);
    }
  }
}

function isValidPeriod(value: string): value is Period {
  return ['7d', '30d', '90d', 'quarter'].includes(value);
}

/**
 *
 * @param value
 */
export function parsePeriod(value?: string): Period {
  if (!value) return '30d';
  if (isValidPeriod(value)) return value;
  return '30d';
}

/**
 * Classify a board column as 'open', 'inProgress', 'inReview', or 'done'.
 * @param col
 * @param col.name
 * @param col.isDefault
 * @param col.isDone
 */
export function classifyColumn(col: { name: string; isDefault: boolean; isDone: boolean }): string {
  if (col.isDone) return 'done';
  if (col.isDefault) return 'open';
  const lower = col.name.toLowerCase();
  if (lower.includes('review') || lower.includes('testen')) return 'inReview';
  if (lower.includes('progress') || lower.includes('ontwikkeling')) return 'inProgress';
  return 'open';
}
