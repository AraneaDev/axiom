import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

/**
 *
 * @param repoId
 * @param data
 * @param data.pattern
 * @param data.requiredReviews
 * @param data.requireCI
 * @param data.noForcePush
 * @param data.noDirectPush
 * @param data.requireLinear
 */
export async function createRule(
  repoId: string,
  data: {
    pattern: string;
    requiredReviews?: number;
    requireCI?: boolean;
    noForcePush?: boolean;
    noDirectPush?: boolean;
    requireLinear?: boolean;
  },
) {
  const existing = await prisma.branchProtection.findUnique({
    where: { repoId_pattern: { repoId, pattern: data.pattern } },
  });
  if (existing) throw new AppError(409, 'Protection rule for this pattern already exists');

  return prisma.branchProtection.create({
    data: { repoId, ...data },
  });
}

/**
 *
 * @param repoId
 */
export async function listRules(repoId: string) {
  return prisma.branchProtection.findMany({
    where: { repoId },
    orderBy: { pattern: 'asc' },
  });
}

/**
 *
 * @param ruleId
 */
export async function getRule(ruleId: string) {
  const rule = await prisma.branchProtection.findUnique({ where: { id: ruleId } });
  if (!rule) throw new AppError(404, 'Protection rule not found');
  return rule;
}

/**
 *
 * @param ruleId
 * @param data
 * @param data.requiredReviews
 * @param data.requireCI
 * @param data.noForcePush
 * @param data.noDirectPush
 * @param data.requireLinear
 */
export async function updateRule(
  ruleId: string,
  data: {
    requiredReviews?: number;
    requireCI?: boolean;
    noForcePush?: boolean;
    noDirectPush?: boolean;
    requireLinear?: boolean;
  },
) {
  const rule = await prisma.branchProtection.findUnique({ where: { id: ruleId } });
  if (!rule) throw new AppError(404, 'Protection rule not found');
  return prisma.branchProtection.update({ where: { id: ruleId }, data });
}

/**
 *
 * @param ruleId
 */
export async function deleteRule(ruleId: string) {
  const rule = await prisma.branchProtection.findUnique({ where: { id: ruleId } });
  if (!rule) throw new AppError(404, 'Protection rule not found');
  await prisma.branchProtection.delete({ where: { id: ruleId } });
}

/**
 * Check if a branch matches any protection rules for a repo.
 * Returns the matching rule or null.
 * @param repoId
 * @param branchName
 */
export async function getMatchingRule(repoId: string, branchName: string) {
  const rules = await prisma.branchProtection.findMany({ where: { repoId } });

  for (const rule of rules) {
    if (matchesPattern(rule.pattern, branchName)) {
      return rule;
    }
  }
  return null;
}

/**
 * Simple glob matching: supports exact match and trailing wildcard.
 * "main" matches "main"
 * "release/*" matches "release/v1.0", "release/hotfix"
 * "*" matches everything
 * @param pattern
 * @param branchName
 */
function matchesPattern(pattern: string, branchName: string): boolean {
  if (pattern === '*') return true;
  if (pattern === branchName) return true;
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1); // "release/"
    return branchName.startsWith(prefix);
  }
  return false;
}

/**
 * Enforce protection rules before a merge.
 * Throws AppError if any rule is violated.
 * @param repoId
 * @param targetBranch
 * @param prId
 */
export async function enforceMergeProtection(repoId: string, targetBranch: string, prId: string) {
  const rule = await getMatchingRule(repoId, targetBranch);
  if (!rule) return; // No protection

  if (rule.requiredReviews > 0) {
    const approvedCount = await prisma.pRReview.count({
      where: {
        prId,
        status: 'APPROVED',
      },
    });
    if (approvedCount < rule.requiredReviews) {
      throw new AppError(
        403,
        `Requires at least ${rule.requiredReviews} approved review(s), has ${approvedCount}`,
      );
    }
  }


  if (rule.requireCI) {
    const pr = await prisma.pullRequest.findUnique({ where: { id: prId } });
    if (!pr || pr.ciStatus !== 'SUCCESS') {
      throw new AppError(403, 'CI checks must pass before merging');
    }
  }

  if (rule.requireLinear) {
    const pr = await prisma.pullRequest.findUnique({ where: { id: prId } });
    if (pr) {
      const mergeStrategy = pr.mergeStrategy || 'merge';
      if (mergeStrategy === 'merge') {
        throw new AppError(
          403,
          'Linear history required: use squash or rebase merge strategy instead of merge commit',
        );
      }
    }
  }
}
