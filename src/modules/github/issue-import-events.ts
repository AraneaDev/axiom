// The `issues` and `issue_comment` handlers of the GitHub Issues import. Imported by
// webhook-handlers.ts, so the API and the worker both run them. Nothing happens unless the link
// has import switched on, and nothing in Axiom is closed, moved or deleted by what GitHub does.
import { z } from 'zod';

import { prisma } from '../../config/database';
import { logActivity } from '../activity/activity.service';

import { orgActorId, resolveGithubActor } from './github-actor';
import { senderSchema, timestamp, touchLinkDelivery } from './github-store';
import { ImportCappedError } from './import-cap';
import { importComment, importGithubIssue, type GithubIssuePayload } from './issue-import.service';
import { onGithubEvent, type GithubDeliveryContext } from './webhook-dispatch';

const issueRef = z.object({
  number: z.number().int().positive(),
  created_at: timestamp.optional(),
  pull_request: z.unknown().optional(),
});
const issuesPayload = z.object({ issue: issueRef });
const commentPayload = z.object({ issue: issueRef, comment: z.object({ id: z.number().int() }) });

/** What GitHub did that Axiom only notes on the imported issue */
const NOTED = new Map([
  ['closed', 'github_closed'],
  ['deleted', 'github_deleted'],
  ['transferred', 'github_transferred'],
]);
const IMPORTING = new Set(['opened', 'reopened', 'edited', 'labeled', 'unlabeled']);

// The link of the delivery's repository, when it imports issues
async function importingLink(d: GithubDeliveryContext) {
  const link = await touchLinkDelivery(d);
  return link?.importIssues ? link : null;
}

/**
 * Runs an import, and answers a capped one as ignored with the reason: the delivery is not
 * retried, and what it would have imported comes in on its next update or the next reconcile.
 * @param work The import
 */
async function capped<T>(work: () => Promise<T>): Promise<T | { ignored: string }> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof ImportCappedError) return { ignored: err.message };
    throw err;
  }
}

const findImport = (repoLinkId: string, githubIssueNumber: number) =>
  prisma.githubIssueImport.findUnique({
    where: { repoLinkId_githubIssueNumber: { repoLinkId, githubIssueNumber } },
  });

onGithubEvent('issues', async (d) => {
  if (!d.action) return 'ignored';
  const parsed = issuesPayload.safeParse(d.payload);
  if (!parsed.success || parsed.data.issue.pull_request) return 'ignored';
  const link = await importingLink(d);
  if (!link) return 'ignored';
  const { number } = parsed.data.issue;
  const sender = senderSchema.parse(d.payload.sender);

  const noted = NOTED.get(d.action);
  if (noted) {
    const row = await findImport(link.id, number);
    // Never imported, or deleted in Axiom since: nothing to note it on
    if (!row?.issueId) return 'ignored';
    const issueId = row.issueId;
    // A redelivery notes nothing twice
    const seen = await prisma.activity.findFirst({
      where: {
        resourceId: issueId,
        action: noted,
        details: { path: ['deliveryId'], equals: d.deliveryId },
      },
      select: { id: true },
    });
    if (!seen) {
      const writerId = await orgActorId(await resolveGithubActor(sender), link.projectId);
      await logActivity('issue', issueId, noted, writerId, {
        deliveryId: d.deliveryId,
        githubIssueNumber: number,
        login: sender?.login ?? null,
      });
    }
    return 'processed';
  }
  if (!IMPORTING.has(d.action)) return 'ignored';

  // Only an issue made on GitHub after the link is news for the issue:created rules. GitHub sends
  // `opened` and a `labeled` per label of a new issue at once, and whichever runs first makes
  // it; one found through an edit or a reopen may be years old (the backfill's rule)
  const createdAt = parsed.data.issue.created_at;
  const isNew =
    (d.action === 'opened' || d.action === 'labeled') &&
    !!createdAt &&
    new Date(createdAt) >= link.createdAt;
  const result = await capped(() =>
    importGithubIssue(link, d.payload.issue as GithubIssuePayload, {
      // Read once per import, so a delivery that failed after the issue was made reads them again
      withComments: true,
      sender,
      runRules: { created: isNew, updated: true },
      live: true,
    }),
  );
  if (typeof result === 'object' && result !== null && 'ignored' in result) return result;
  return result ? 'processed' : 'ignored';
});

onGithubEvent('issue_comment', async (d) => {
  if (d.action !== 'created' && d.action !== 'edited') return 'ignored';
  const parsed = commentPayload.safeParse(d.payload);
  // A pull request's conversation is no imported issue's
  if (!parsed.success || parsed.data.issue.pull_request) return 'ignored';
  const link = await importingLink(d);
  if (!link) return 'ignored';
  const row = await findImport(link.id, parsed.data.issue.number);
  if (!row?.issueId) return 'ignored';
  const result = await capped(() =>
    importComment(row, d.payload.comment as Parameters<typeof importComment>[1], { live: true }),
  );
  return typeof result === 'object' && result !== null ? result : 'processed';
});
