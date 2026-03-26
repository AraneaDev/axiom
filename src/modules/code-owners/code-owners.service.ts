import { prisma } from '../../config/database';
import * as gitCmd from '../../git/git-commands';
import { repoExists } from '../../git/repo-manager';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';

export interface CodeOwnerRule {
  pattern: string;
  owners: string[];
}

/**
 * Parse CODEOWNERS file from a repo at the given ref.
 * Looks in: root, .github/, docs/
 * @param repoId
 * @param ref
 */
export async function parseCodeOwners(repoId: string, ref: string): Promise<CodeOwnerRule[]> {
  const repo = await findOrThrow(
    prisma.repository.findUnique({ where: { id: repoId } }),
    'Repository not found',
  );
  if (!repo.diskPath) throw new AppError(404, 'Repository not found');
  if (!(await repoExists(repo.diskPath))) throw new AppError(404, 'Repository not on disk');

  const paths = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];

  let content: string | null = null;
  for (const p of paths) {
    try {
      content = await gitCmd.showBlob(repo.diskPath, ref, p);
      break;
    } catch {
      // File not found at this path, try next
    }
  }

  if (!content) return [];

  return parseCodeOwnersContent(content);
}

/**
 * Parse CODEOWNERS file content into rules.
 * @param content
 */
export function parseCodeOwnersContent(content: string): CodeOwnerRule[] {
  const rules: CodeOwnerRule[] = [];
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;

    const pattern = parts[0];
    const owners = parts.slice(1).filter((o) => o.startsWith('@'));

    if (owners.length > 0) {
      rules.push({ pattern, owners });
    }
  }

  return rules;
}

/**
 * Match a file path against a CODEOWNERS glob pattern.
 * @param pattern
 * @param filePath
 */
function matchPattern(pattern: string, filePath: string): boolean {
  // Normalize: remove leading slash
  const p = pattern.startsWith('/') ? pattern.slice(1) : pattern;
  const f = filePath.startsWith('/') ? filePath.slice(1) : filePath;

  // Directory pattern (ends with /)
  if (p.endsWith('/')) {
    const dir = p.slice(0, -1);
    return f.startsWith(dir + '/') || f === dir;
  }

  // Simple glob conversion for CODEOWNERS patterns
  // * matches anything except /
  // ** matches anything including /
  const regexStr = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*')
    .replace(/\?/g, '[^/]');

  const regex = new RegExp(`^${regexStr}$`);

  // Try matching full path
  if (regex.test(f)) return true;

  // For patterns without /, match against basename
  if (!p.includes('/')) {
    const basename = f.split('/').pop() ?? f;
    if (regex.test(basename)) return true;
  }

  // For patterns without leading /, also try matching as suffix
  if (!pattern.startsWith('/')) {
    // Match if any suffix of the path matches
    const parts = f.split('/');
    for (let i = 0; i < parts.length; i++) {
      const subPath = parts.slice(i).join('/');
      if (regex.test(subPath)) return true;
    }
  }

  return false;
}

/**
 * Get owners for a list of files based on CODEOWNERS rules.
 * Later rules take precedence (like .gitignore).
 * @param repoId
 * @param ref
 * @param filePaths
 */
export async function getOwnersForFiles(
  repoId: string,
  ref: string,
  filePaths: string[],
): Promise<{ file: string; owners: string[] }[]> {
  const rules = await parseCodeOwners(repoId, ref);
  if (rules.length === 0) return filePaths.map((f) => ({ file: f, owners: [] }));

  return filePaths.map((filePath) => {
    let matchedOwners: string[] = [];
    // Later rules override earlier ones
    for (const rule of rules) {
      if (matchPattern(rule.pattern, filePath)) {
        matchedOwners = rule.owners;
      }
    }
    return { file: filePath, owners: matchedOwners };
  });
}

/**
 * Get code owners for a PR's changed files.
 * @param repoId
 * @param prNumber
 */
export async function getOwnersForPR(repoId: string, prNumber: number) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );

  const repo = await findOrThrow(
    prisma.repository.findUnique({ where: { id: repoId } }),
    'Repository not found',
  );
  if (!repo.diskPath) throw new AppError(404, 'Repository not found');
  if (!(await repoExists(repo.diskPath))) throw new AppError(404, 'Repository not on disk');

  // Get changed files
  const stats = await gitCmd.diffStat(repo.diskPath, pr.targetBranch, pr.sourceBranch);
  const filePaths = stats.map((s) => s.file);

  // Get owners using target branch CODEOWNERS (the branch we're merging into)
  const fileOwners = await getOwnersForFiles(repoId, pr.targetBranch, filePaths);

  // Collect unique owners
  const allOwners = new Set<string>();
  for (const fo of fileOwners) {
    for (const owner of fo.owners) {
      allOwners.add(owner);
    }
  }

  // Check approval status for each owner
  const reviews = await prisma.pRReview.findMany({
    where: { prId: pr.id },
    orderBy: { createdAt: 'desc' },
  });

  // Look up reviewer usernames
  const reviewerIds = [...new Set(reviews.map((r) => r.reviewerId))];
  const reviewerUsers = await prisma.user.findMany({
    where: { id: { in: reviewerIds } },
    select: { id: true, username: true },
  });
  const reviewerMap = new Map(reviewerUsers.map((u) => [u.id, u.username]));

  const ownerStatuses = [...allOwners].map((owner) => {
    const ownerName = owner.replace('@', '');
    // Find most recent review from this owner
    const review = reviews.find((r) => reviewerMap.get(r.reviewerId) === ownerName);
    return {
      owner,
      approved: review?.status === 'APPROVED',
      reviewStatus: review?.status ?? null,
    };
  });

  return {
    fileOwners,
    owners: ownerStatuses,
    allApproved: ownerStatuses.length === 0 || ownerStatuses.every((o) => o.approved),
  };
}
