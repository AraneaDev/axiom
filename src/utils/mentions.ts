import { marked, type Token } from 'marked';

type TokenWithChildren = Token & {
  tokens?: Token[];
  items?: Token[];
  header?: Array<{ tokens: Token[] }>;
  rows?: Array<Array<{ tokens: Token[] }>>;
};

function childrenOf(token: TokenWithChildren): Token[] {
  if (token.type === 'table') {
    return [
      ...(token.header ?? []).flatMap((cell) => cell.tokens),
      ...(token.rows ?? []).flat().flatMap((cell) => cell.tokens),
    ];
  }
  return token.tokens ?? token.items ?? [];
}

// The token's source with every code span and block blanked out (same length, newlines kept)
function withoutCode(token: Token): string {
  if (token.type === 'code' || token.type === 'codespan') return token.raw.replace(/[^\n]/g, ' ');
  let rest = token.raw;
  let out = '';
  for (const child of childrenOf(token)) {
    const at = rest.indexOf(child.raw);
    if (at < 0) continue;
    out += rest.slice(0, at) + withoutCode(child);
    rest = rest.slice(at + child.raw.length);
  }
  return out + rest;
}

/**
 * The text with its code blanked out, so a mention or reference inside inline code, a fenced
 * block or an indented block is not one. The frontend renderer styles by the same rule.
 * @param text The Markdown
 */
function withoutCodeOf(text: string): string {
  try {
    return marked
      .lexer(text, { gfm: true })
      .map((token) => withoutCode(token))
      .join('');
  } catch {
    return text;
  }
}

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
 * A mention has no letter, digit or underscore right before the `@` (so `a@b.com` mentions
 * nobody), is not escaped with a backslash and is not in code.
 * Returns an array of unique usernames (without the @ prefix).
 * @param text
 */
export function parseMentions(text: string): string[] {
  const re = /(?<![A-Za-z0-9_])@([a-zA-Z0-9_-]+)/g;
  const usernames = new Set<string>();
  const visible = withoutCodeOf(text);
  let match: RegExpExecArray | null;
  while ((match = re.exec(visible)) !== null) {
    if (isEscaped(visible, match.index)) continue;
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
  const visible = withoutCodeOf(text);
  let match: RegExpExecArray | null;
  while ((match = re.exec(visible)) !== null) {
    if (isEscaped(visible, match.index)) continue;
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
