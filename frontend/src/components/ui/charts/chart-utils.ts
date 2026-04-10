/** Categorical palette — 8 distinct colors for data series. */
export const CHART_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
  'var(--color-chart-7)',
  'var(--color-chart-8)',
] as const;

/** Sequential palette — 5 shades for magnitude/heatmap data. */
export const CHART_SEQ_COLORS = [
  'var(--color-chart-seq-1)',
  'var(--color-chart-seq-2)',
  'var(--color-chart-seq-3)',
  'var(--color-chart-seq-4)',
  'var(--color-chart-seq-5)',
] as const;

/**
 * Return a color from the categorical palette by index (wraps at 8).
 * @param index
 */
export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/**
 * Return a sequential palette color for a value between min and max.
 * Clamps to the palette range.
 * @param value
 * @param min
 * @param max
 */
export function seqColor(value: number, min: number, max: number): string {
  if (max <= min) return CHART_SEQ_COLORS[0];
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const index = Math.min(CHART_SEQ_COLORS.length - 1, Math.floor(ratio * CHART_SEQ_COLORS.length));
  return CHART_SEQ_COLORS[index];
}

/**
 * Calculate SVG viewBox width based on data count and per-item width.
 * Ensures enough room for all items without clipping.
 * @param itemCount
 * @param itemWidth
 * @param gap
 * @param paddingLeft
 * @param paddingRight
 */
export function calcViewBoxWidth(
  itemCount: number,
  itemWidth: number,
  gap: number,
  paddingLeft: number,
  paddingRight: number,
): number {
  return paddingLeft + paddingRight + itemCount * (itemWidth + gap) + gap;
}

/**
 * Format a number for chart display: 1234 -> "1.2k", 1234567 -> "1.2M".
 * @param n
 */
export function shortNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
