/**
 * Presets the issue list saved have no query text: only rows written as text can be picked.
 * @param query - The saved row's stored query
 */
export const isTextQuery = (query: unknown) =>
  typeof query === 'object' && query !== null && (query as { kind?: unknown }).kind === 'query';
