/**
 * Format an issue key from its project prefix and number.
 * e.g. formatIssueKey('AXM', 42) => 'AXM-42'
 * @param prefix
 * @param number
 */
export function formatIssueKey(prefix: string, number: number): string {
  return `${prefix}-${number}`;
}
