/**
 * Whether the character at an index is escaped with a backslash, as Markdown reads it: an odd
 * number of backslashes right before it. An escaped sigil is literal text, not a mention or a
 * reference, so what renders and what notifies agree.
 * @param text The text
 * @param index The index of the character
 */
function isEscaped(text: string, index: number): boolean {
  let count = 0;
  while (index - count - 1 >= 0 && text[index - count - 1] === '\\') count++;
  return count % 2 === 1;
}

/**
 * Parse `@username` mentions from text.
 * Returns an array of unique usernames (without the @ prefix).
 * @param text
 */
export function parseMentions(text: string): string[] {
  const re = /@([a-zA-Z0-9_-]+)/g;
  const usernames = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (isEscaped(text, match.index)) continue;
    usernames.add(match[1]);
  }
  return Array.from(usernames);
}

/**
 * Parse ^PREFIX-123 (or legacy #PREFIX-123) issue references from text.
 * Returns an array of { prefix, number } objects.
 * @param text
 */
export function parseIssueRefs(text: string): Array<{ prefix: string; number: number }> {
  const re = /[#^]([A-Z]+-\d+)/g;
  const seen = new Set<string>();
  const refs: Array<{ prefix: string; number: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (isEscaped(text, match.index)) continue;
    const key = match[1];
    if (seen.has(key)) continue;
    seen.add(key);
    const dashIdx = key.lastIndexOf('-');
    refs.push({
      prefix: key.slice(0, dashIdx),
      number: parseInt(key.slice(dashIdx + 1), 10),
    });
  }
  return refs;
}
