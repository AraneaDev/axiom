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
