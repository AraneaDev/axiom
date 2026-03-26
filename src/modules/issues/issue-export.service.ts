import { prisma } from '../../config/database';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

/**
 * Export issues as CSV.
 * @param projectId - The project ID
 * @returns CSV string
 */
export async function exportIssuesCsv(projectId: string) {
  const project = await findOrThrow(
    prisma.project.findUnique({
      where: { id: projectId },
      include: { columns: true },
    }),
    'Project not found',
  );

  const columnMap = new Map(project.columns.map((c) => [c.id, c.name]));

  const issues = await prisma.issue.findMany({
    where: { projectId },
    include: {
      assignee: { select: USER_BASIC_SELECT },
      creator: { select: USER_BASIC_SELECT },
    },
    orderBy: { number: 'asc' },
  });

  const header = [
    'Key',
    'Title',
    'Status',
    'Priority',
    'Type',
    'Assignee',
    'Created',
    'Estimate (min)',
    'Logged (min)',
  ];
  const rows = issues.map((issue) => [
    `${project.prefix}-${issue.number}`,
    `"${issue.title.replace(/"/g, '""')}"`,
    issue.columnId ? (columnMap.get(issue.columnId) ?? '') : '',
    issue.priority,
    issue.type,
    issue.assignee?.displayName ?? '',
    issue.createdAt.toISOString().slice(0, 10),
    issue.timeEstimate?.toString() ?? '',
    issue.timeSpent?.toString() ?? '',
  ]);

  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
