import { prisma } from '../../config/database';

import { parseSmartCommit, parseTimeDuration, SmartCommitResult } from './smart-commits.service';

/**
 *
 * @param commitMessage
 * @param repoId
 * @param authorUserId
 */
export async function executeSmartCommit(
  commitMessage: string,
  repoId: string,
  authorUserId: string | null,
): Promise<void> {
  const results = parseSmartCommit(commitMessage);
  if (results.length === 0) return;

  for (const result of results) {
    await executeDirectivesForIssue(result, repoId, authorUserId);
  }
}

async function executeDirectivesForIssue(
  result: SmartCommitResult,
  _repoId: string,
  authorUserId: string | null,
): Promise<void> {
  const match = result.issueKey.match(/^([A-Z]+)-(\d+)$/);
  if (!match) return;

  const [, prefix, numStr] = match;
  const issueNumber = parseInt(numStr, 10);

  const issue = await prisma.issue.findFirst({
    where: {
      number: issueNumber,
      project: { prefix },
    },
    include: {
      project: { include: { columns: true } },
    },
  });

  if (!issue) return;

  for (const directive of result.directives) {
    switch (directive.type) {
      case 'time': {
        const minutes = parseTimeDuration(directive.value);
        if (minutes > 0 && authorUserId) {
          await prisma.timeEntry.create({
            data: {
              issueId: issue.id,
              userId: authorUserId,
              minutes,
              description: 'Logged via smart commit',
              loggedAt: new Date(),
            },
          });
        }
        break;
      }
      case 'comment': {
        if (directive.value && authorUserId) {
          await prisma.comment.create({
            data: {
              issueId: issue.id,
              authorId: authorUserId,
              body: directive.value,
            },
          });
        }
        break;
      }
      case 'transition': {
        const columns = issue.project.columns;
        let targetColumn;
        if (directive.value === 'resolve' || directive.value === 'close') {
          targetColumn = columns.find((c) => c.isDone);
        } else if (directive.value === 'reopen') {
          targetColumn = columns.find((c) => c.isDefault);
        }
        if (targetColumn && targetColumn.id !== issue.columnId) {
          await prisma.issue.update({
            where: { id: issue.id },
            data: { columnId: targetColumn.id },
          });
        }
        break;
      }
      case 'assign': {
        const user = await prisma.user.findFirst({
          where: { username: directive.value },
        });
        if (user) {
          await prisma.issue.update({
            where: { id: issue.id },
            data: { assigneeId: user.id },
          });
        }
        break;
      }
      case 'label': {
        const label = await prisma.label.findFirst({
          where: {
            name: directive.value,
            projectId: issue.projectId,
          },
        });
        if (label) {
          await prisma.issue.update({
            where: { id: issue.id },
            data: {
              labels: { connect: { id: label.id } },
            },
          });
        }
        break;
      }
    }
  }
}
