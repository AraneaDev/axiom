import type { GithubLinkSource, GithubLinkTarget, Prisma } from '@prisma/client';

import { prisma } from '../../config/database';

import { isUniqueViolation } from './github-errors';
import { MAX_KEYS_PER_TARGET, drivesAutomation, extractIssueNumbers } from './issue-keys';

export type LinkTarget = { type: GithubLinkTarget; key: string };

export type SyncResult = {
  added: string[];
  removed: string[];
  linked: string[];
  driving: string[];
};

/**
 * One attempt on a transaction client: reads the target's links and writes the difference.
 * @param tx The transaction to run in
 * @param repoLinkId The repository link
 * @param target The branch, pull request or commit
 * @param texts The texts that may name issues, by source
 */
async function syncOnce(
  tx: Prisma.TransactionClient,
  repoLinkId: string,
  target: LinkTarget,
  texts: Partial<Record<GithubLinkSource, string>>,
): Promise<SyncResult> {
  {
    const repoLink = await tx.githubRepoLink.findUnique({
      where: { id: repoLinkId },
      select: { project: { select: { id: true, prefix: true } } },
    });
    if (!repoLink) return { added: [], removed: [], linked: [], driving: [] };
    const { id: projectId, prefix } = repoLink.project;

    // number -> sources that name it. A prefix renamed since a link was made leaves that link
    // as it is; texts are read with the prefix the project has now.
    const named = new Map<number, GithubLinkSource[]>();
    for (const [source, text] of Object.entries(texts) as [GithubLinkSource, string][]) {
      for (const number of extractIssueNumbers(text ?? '', prefix)) {
        const sources = named.get(number);
        if (sources) sources.push(source);
        // At most 20 issues per target, whichever texts name them
        else if (named.size < MAX_KEYS_PER_TARGET) named.set(number, [source]);
      }
    }
    const issues = named.size
      ? await tx.issue.findMany({
          where: { projectId, number: { in: [...named.keys()] } },
          select: { id: true, number: true },
        })
      : [];
    const wanted = new Map<string, GithubLinkSource[]>(
      issues.map((issue) => [issue.id, named.get(issue.number) ?? []]),
    );

    const existing = await tx.githubIssueLink.findMany({
      where: { repoLinkId, targetType: target.type, targetKey: target.key },
    });
    const existingByIssue = new Map(existing.map((link) => [link.issueId, link]));

    const added: string[] = [];
    const removed: string[] = [];
    for (const link of existing) {
      if (wanted.has(link.issueId)) continue;
      await tx.githubIssueLink.delete({ where: { id: link.id } });
      removed.push(link.issueId);
    }
    for (const [issueId, sources] of wanted) {
      const link = existingByIssue.get(issueId);
      if (!link) {
        await tx.githubIssueLink.create({
          data: {
            issueId,
            repoLinkId,
            targetType: target.type,
            targetKey: target.key,
            sources,
          },
        });
        added.push(issueId);
      } else if (
        link.sources.length !== sources.length ||
        !sources.every((source) => link.sources.includes(source))
      ) {
        await tx.githubIssueLink.update({ where: { id: link.id }, data: { sources } });
      }
    }

    return {
      added,
      removed,
      linked: [...wanted.keys()],
      driving: [...wanted].filter(([, sources]) => drivesAutomation(sources)).map(([id]) => id),
    };
  }
}

/**
 * Makes the issue links of a branch, pull request or commit say exactly what its texts name
 * now: each issue of the linked project that a text names gets a link whose `sources` are the
 * texts that name it, and a link left with none is deleted. Numbers that are no issue of the
 * project are ignored. Commits are synced once, with `COMMIT_MESSAGE` only.
 * Runs in one transaction, or in the one it is given (then the caller owns the retry and a lock
 * on the target). If two calls race on the unique key the loser tries once more,
 * which then sees the winner's rows.
 * @param repoLinkId The repository link
 * @param target The branch id, pull request id or commit sha, and which of them it is
 * @param texts The texts to read, by source
 * @param tx The caller's transaction, to run in instead of a new one
 * @returns The issue ids added, removed, linked now, and linked through a driving source
 */
export async function syncLinks(
  repoLinkId: string,
  target: LinkTarget,
  texts: Partial<Record<GithubLinkSource, string>>,
  tx?: Prisma.TransactionClient,
): Promise<SyncResult> {
  // In the caller's transaction it holds the caller's lock on the target's row, so nothing races
  // it, and a failure rolls back with everything the caller wrote.
  if (tx) return syncOnce(tx, repoLinkId, target, texts);
  try {
    return await prisma.$transaction((client) => syncOnce(client, repoLinkId, target, texts));
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return prisma.$transaction((client) => syncOnce(client, repoLinkId, target, texts));
  }
}
