import { marked, type Token } from 'marked';

type Node = Token & {
  tokens?: Token[];
  items?: Token[];
  header?: Array<{ tokens: Token[] }>;
  rows?: Array<Array<{ tokens: Token[] }>>;
};

// Block tokens put a line break between their children; inline ones run on
const BLOCK_PARENTS = new Set(['blockquote', 'list_item', 'list']);

/**
 * The text a reader sees, as one string, for the token tree of some Markdown. Code, raw HTML,
 * images, link destinations and autolinks give no text (a blank stands in), and an escaped
 * character stands in as a backslash, which is no word character. The frontend renderer styles
 * by the same rule: only text outside code and links of the URL itself.
 * @param tokens The tokens of one level
 * @param separator What goes between them
 */
function visible(tokens: Token[], separator: string): string {
  let out = '';
  let inCode = false;
  tokens.forEach((token, at) => {
    if (at > 0) out += separator;
    // Raw `<code>` HTML: the text up to its closing tag is code
    if (token.type === 'html') {
      if (/^<code[\s>]/i.test(token.raw)) inCode = true;
      else if (/^<\/code\s*>/i.test(token.raw)) inCode = false;
      out += ' ';
      return;
    }
    out += inCode ? ' ' : textOf(token as Node);
  });
  return out;
}

// A link whose text is its own address reads as an autolink, as the frontend renders it
const isAddress = (link: { text: string; href: string }) =>
  link.text === link.href || `mailto:${link.text}` === link.href;

function textOf(token: Node): string {
  switch (token.type) {
    case 'code':
    case 'codespan':
    case 'image':
    case 'def':
    case 'hr':
      return ' ';
    case 'escape':
      return '\\';
    case 'br':
    case 'space':
      return '\n';
    case 'link':
      // `[text](url)` counts its text; an autolink or a bare URL is the address itself
      return token.raw.startsWith('[') && !isAddress(token as Node & { text: string; href: string })
        ? visible(token.tokens ?? [], '')
        : ' ';
    case 'table':
      return [...(token.header ?? []), ...(token.rows ?? []).flat()]
        .map((cell) => visible(cell.tokens, ''))
        .join('\n');
    default: {
      const children = token.items ?? token.tokens;
      if (!children) return token.raw;
      return visible(children, BLOCK_PARENTS.has(token.type) ? '\n' : '');
    }
  }
}

function visibleText(text: string): string {
  try {
    return visible(marked.lexer(text, { gfm: true }), '\n');
  } catch {
    return text;
  }
}

/**
 * Parse `@username` mentions from text.
 * A mention has no letter, digit or underscore right before the `@` (so `a@b.com` mentions
 * nobody), is not escaped with a backslash, and is plain text: not in code, a link address, an
 * autolink or raw HTML.
 * Returns an array of unique usernames (without the @ prefix).
 * @param text
 */
export function parseMentions(text: string): string[] {
  const re = /(?<![A-Za-z0-9_])@([a-zA-Z0-9_-]+)/g;
  const usernames = new Set<string>();
  for (const match of visibleText(text).matchAll(re)) usernames.add(match[1]);
  return Array.from(usernames);
}

/**
 * Parse ^PREFIX-123 (or legacy #PREFIX-123) issue references from text, by the same rule as
 * mentions.
 * Returns an array of { prefix, number } objects.
 * @param text
 */
export function parseIssueRefs(text: string): Array<{ prefix: string; number: number }> {
  const re = /[#^]([A-Z]+-\d+)/g;
  const seen = new Set<string>();
  const refs: Array<{ prefix: string; number: number }> = [];
  for (const match of visibleText(text).matchAll(re)) {
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
