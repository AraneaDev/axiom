import { settled } from '../../utils/settled';

import {
  getPR,
  getMergeChecks,
  getPRDiff,
  getPRCommits,
  getLinkedIssues,
  listReviews,
  listPRComments,
} from './pulls.service';

/**
 * Hydrate the full PR Detail view in a single call.
 * The primary PR lookup is performed first (404 if not found).
 * All secondary queries fan out in parallel via Promise.allSettled so
 * partial failures degrade gracefully without blocking the response.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 */
export async function hydratePRDetail(repoId: string, prNumber: number) {
  // Primary lookup -- must succeed or 404
  const pr = await getPR(repoId, prNumber);

  // Fan out all secondary queries
  const results = await Promise.allSettled([
    getMergeChecks(repoId, prNumber),
    getPRDiff(repoId, prNumber).then((d) => ({ stats: d.stats })),
    getPRCommits(repoId, prNumber),
    listReviews(repoId, prNumber),
    listPRComments(repoId, prNumber),
    getLinkedIssues(repoId, prNumber),
  ]);

  return {
    pr,
    mergeChecks: settled(results[0], 'mergeChecks'),
    diff: settled(results[1], 'diff'),
    commits: settled(results[2], 'commits'),
    reviews: settled(results[3], 'reviews'),
    comments: settled(results[4], 'comments'),
    linkedIssues: settled(results[5], 'linkedIssues'),
  };
}
