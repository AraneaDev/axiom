import type { GithubLinkSource } from '@prisma/client';

const MAX_KEYS = 20;
const MAX_NUMBER = 2147483647;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\\-/]/g, '\\$&');

/**
 * The issue numbers a text names with a project's prefix: `PREFIX-<digits>`, in any case, not
 * glued to a letter or digit on either side (so `AXMX-4` does not name `AXM-4`, and `AXM-42a`
 * names nothing).
 * @param text A branch name, title, body or commit message
 * @param prefix The project's issue key prefix
 * @returns The numbers (1 to 2147483647) in order of appearance, without duplicates, at most 20
 */
export function extractIssueNumbers(text: string, prefix: string): number[] {
  if (!prefix) return [];
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(prefix)}-(\\d+)(?![A-Za-z0-9])`, 'gi');
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
