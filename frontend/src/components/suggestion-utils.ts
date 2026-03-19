const SUGGESTION_RE = /```suggestion\n([\s\S]*?)```/;

/**
 *
 * @param body
 */
export function parseSuggestion(body: string): string | null {
  const match = body.match(SUGGESTION_RE);
  return match ? match[1] : null;
}

/**
 *
 * @param body
 */
export function hasSuggestion(body: string): boolean {
  return SUGGESTION_RE.test(body);
}
