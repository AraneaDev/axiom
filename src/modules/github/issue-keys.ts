import type { GithubLinkSource } from '@prisma/client';

const MAX_KEYS = 20;
const MAX_NUMBER = 2147483647;

// Under the `u` flag `\-` is a syntax error, and a hyphen outside a class needs no escape
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

export const MAX_KEYS_PER_TARGET = MAX_KEYS;

/**
 * The issue numbers a text names with a project's prefix: `PREFIX-<digits>`, in any case, not
 * glued to a letter or digit (of any script) on either side, so `AXMX-4` does not name `AXM-4`,
 * `éAXM-4` names nothing and `AXM-42a` names nothing. Leading zeros are read as the number they
 * spell: `AXM-007` names 7.
 * @param text A branch name, title, body or commit message
 * @param prefix The project's issue key prefix
 * @returns The numbers (1 to 2147483647) in order of appearance, without duplicates, at most 20
 */
export function extractIssueNumbers(text: string, prefix: string): number[] {
  if (!prefix) return [];
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(prefix)}-(\\d+)(?![\\p{L}\\p{N}])`,
    'giu',
  );
  const found: number[] = [];
  for (const match of text.matchAll(pattern)) {
    const number = Number(match[1]);
    if (number < 1 || number > MAX_NUMBER || found.includes(number)) continue;
    found.push(number);
    if (found.length === MAX_KEYS) break;
  }
  return found;
}

/**
 * Whether a link made through these sources may move an issue by automation: only a branch name
 * or a pull request title says that the work is for the issue.
 * @param sources The texts that name the issue
 */
export function drivesAutomation(sources: GithubLinkSource[]): boolean {
  return sources.includes('BRANCH_NAME') || sources.includes('PR_TITLE');
}
