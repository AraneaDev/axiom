/** Postgres can't store or compare NUL in text, so a query holding it fails rather than misses. */
const NUL = '\u0000';

/**
 * Whether a parsed JSON value or query holds NUL in any string or key. Walks with its own stack, so
 * nesting depth can't overflow the call stack.
 * @param root - The value
 */
export function containsNul(root: unknown): boolean {
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === 'string') {
      if (value.includes(NUL)) return true;
    } else if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, inner] of Object.entries(value)) {
        if (key.includes(NUL)) return true;
        pending.push(inner);
      }
    }
  }
  return false;
}
