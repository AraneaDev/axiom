/**
 * A URL from GitHub that is safe to put in an `href`: https only. The server checks this when it
 * stores a URL, this is the second check on the way out.
 * @param url - The stored URL.
 * @returns The URL, or undefined for anything that is not https.
 */
export function httpsHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Props that open a GitHub page in a new tab without handing it the opener */
export const EXTERNAL_LINK = { target: '_blank', rel: 'noopener noreferrer' } as const;

const MAX_QUOTED_LENGTH = 80;

/**
 * A name in quotes the way the server's approval previews write it: one line, no double quotes,
 * at most 80 characters.
 * @param text - The name.
 */
export function quoted(text: string): string {
  const line = text.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  return line.length > MAX_QUOTED_LENGTH ? `"${line.slice(0, MAX_QUOTED_LENGTH)}..."` : `"${line}"`;
}

/**
 * What unlinking takes away, in the words of the server's preview for the same action.
 * @param repo - The repository as owner/name.
 * @param project - The project's prefix and name.
 * @param project.prefix - The issue key prefix.
 * @param project.name - The project name.
 * @param issues - How many issues have GitHub data from the link.
 */
export function unlinkPreview(
  repo: string,
  project: { prefix: string; name: string },
  issues: number,
): string {
  return (
    `Unlink ${repo} from project ${project.prefix} ${quoted(project.name)}: ` +
    `its branches, pull requests and checks disappear from ${issues} ${issues === 1 ? 'issue' : 'issues'}`
  );
}
