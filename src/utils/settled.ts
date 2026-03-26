/**
 * Extract value from a PromiseSettledResult, logging failures.
 */
export function settled<T>(result: PromiseSettledResult<T>, label: string): T | null {
  if (result.status === 'fulfilled') return result.value;
  console.warn(`[hydrate] partial failure in ${label}:`, result.reason);
  return null;
}
