const MAX_SLUG = 40;

/**
 * The branch name the server proposes for an issue: `<prefix lower>-<number>-<title slug>`. The
 * slug is the title in lower-case ASCII (accents dropped) with every other run of characters as one `-`, cut to 40
 * characters at a `-`. Mirrors `branchNameFor` on the server, which stays the authority.
 * @param prefix - The project's key prefix.
 * @param number - The issue number.
 * @param title - The issue title.
 */
export function branchNameFor(prefix: string, number: number, title: string): string {
  let slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > MAX_SLUG) {
    const cut = slug.slice(0, MAX_SLUG);
    slug = slug[MAX_SLUG] === '-' || !cut.includes('-') ? cut : cut.slice(0, cut.lastIndexOf('-'));
    slug = slug.replace(/-+$/, '');
  }
  const head = `${prefix.toLowerCase()}-${number}`;
  return slug ? `${head}-${slug}` : head;
}

/**
 * The project prefix of an issue key (`AXM-12` gives `AXM`).
 * @param key - The issue key.
 */
export function prefixOfKey(key: string): string {
  const dash = key.lastIndexOf('-');
  return dash < 0 ? key : key.slice(0, dash);
}

/**
 * A word for a POSIX shell line: single-quoted, with an embedded single quote closed, escaped and
 * reopened. Git's ref rules allow `;`, `|`, `$` and backticks, so a branch name needs this.
 * @param text - The word to quote.
 */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}
