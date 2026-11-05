/**
 * The text of a live block: what `:::query <target>:::` can name. Plain string work with no editor
 * in it, for what reads or writes targets without loading one.
 */

/** What a live block shows: the three forms of the text between `:::query ` and `:::`. */
export type QueryEmbedTarget =
  | { kind: 'dashboard'; id: string }
  | { kind: 'savedQuery'; id: string }
  | { kind: 'inline'; query: string };

const DASHBOARD_PREFIX = 'dashboard:';
const INLINE_PREFIX = 'inline:';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const EMBED_LINE = /^:::query\s+(\S.*):::$/;

/**
 * Read an embed's target.
 * @param target - The text as written in Markdown: a saved query id, `dashboard:<id>` or
 * `inline:"<query>"`, the query JSON-quoted
 * @returns What it names, or null when it is none of the three
 */
export function parseQueryEmbedTarget(target: string): QueryEmbedTarget | null {
  if (target.startsWith(DASHBOARD_PREFIX)) {
    const id = target.slice(DASHBOARD_PREFIX.length);
    return ID.test(id) ? { kind: 'dashboard', id } : null;
  }
  if (target.startsWith(INLINE_PREFIX)) {
    try {
      const query: unknown = JSON.parse(target.slice(INLINE_PREFIX.length));
      return typeof query === 'string' && query.trim() ? { kind: 'inline', query } : null;
    } catch {
      return null;
    }
  }
  return ID.test(target) ? { kind: 'savedQuery', id: target } : null;
}

/**
 * Write an embed's target, the reverse of parseQueryEmbedTarget.
 * @param target - What it names
 * @returns The text for the Markdown
 */
export function formatQueryEmbedTarget(target: QueryEmbedTarget): string {
  switch (target.kind) {
    case 'dashboard':
      return `${DASHBOARD_PREFIX}${target.id}`;
    case 'savedQuery':
      return target.id;
    case 'inline':
      return `${INLINE_PREFIX}${JSON.stringify(target.query)}`;
  }
}

/**
 * The target of an embed line. Anything else stays what it was, ordinary text.
 * @param line - One line of Markdown, without its indent
 * @returns The target as written, or null when the line is no embed
 */
export function queryEmbedTargetOfLine(line: string): string | null {
  const match = EMBED_LINE.exec(line.trimEnd());
  return match && parseQueryEmbedTarget(match[1]) ? match[1] : null;
}
