import { z } from 'zod';

import { prisma } from '../../config/database';
import * as issuesService from '../../modules/issues/issues.service';
import * as sprintsService from '../../modules/sprints/sprints.service';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';
import { assertMcpPermission } from '../mcp-permissions';

import type { McpToolContext } from './types';

/**
 *
 * @param ctx
 */
export function registerIssueTools(ctx: McpToolContext) {
  const { server, userId, getOrgIdFromProject, getOrgIdFromSprint } = ctx;

  server.tool(
    'list_issues',
    'List issues in a project, optionally filtered by type, priority, or assignee',
    {
      projectId: z.string().describe('Project ID'),
      type: z.enum(['TASK', 'BUG', 'STORY', 'EPIC']).optional(),
      priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
      assigneeId: z.string().optional(),
      cursor: z.string().optional().describe('Cursor for pagination (issue ID to start after)'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    },
    async ({ projectId, type, priority, assigneeId, cursor, limit }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('list_issues', orgId);
      const where: Record<string, unknown> = { projectId };
      if (type) where.type = type;
      if (priority) where.priority = priority;
      if (assigneeId) where.assigneeId = assigneeId;
      const take = Math.min(limit, 100);
      const issues = await prisma.issue.findMany({
        where,
        include: {
          project: { select: { prefix: true } },
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { name: true } },
        },
        take: take + 1,
        orderBy: { updatedAt: 'desc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = issues.length > take;
      const page = hasMore ? issues.slice(0, take) : issues;
      const data = page.map((i) => ({
        id: i.id,
        key: `${i.project.prefix}-${i.number}`,
        title: i.title,
        type: i.type,
        priority: i.priority,
        status: i.column?.name ?? 'Unassigned',
        assignee: i.assignee?.displayName ?? 'Unassigned',
        labels: i.labels.map((l) => l.name),
      }));
      const result: Record<string, unknown> = { data };
      if (hasMore) result.next_cursor = page[page.length - 1].id;
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'get_issue',
    'Get full details of a specific issue by project ID and issue number',
    { projectId: z.string(), issueNumber: z.number() },
    async ({ projectId, issueNumber }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('get_issue', orgId);
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      const issue = await prisma.issue.findUnique({
        where: { projectId_number: { projectId, number: issueNumber } },
        include: {
          assignee: { select: USER_BASIC_SELECT },
          creator: { select: USER_BASIC_SELECT },
          labels: true,
          column: true,
          comments: {
            include: { author: { select: { username: true, displayName: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!issue) return { content: [{ type: 'text' as const, text: 'Issue not found' }] };
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ...issue, key: `${project.prefix}-${issue.number}` }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'create_issue',
    'Create a new issue in a project',
    {
      projectId: z.string(),
      title: z.string(),
      body: z.string().default(''),
      type: z.enum(['TASK', 'BUG', 'STORY', 'EPIC']).default('TASK'),
      priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
      assigneeId: z.string().optional(),
    },
    async ({ projectId, title, body, type, priority, assigneeId }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('create_issue', orgId);
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      const lastIssue = await prisma.issue.findFirst({
        where: { projectId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (lastIssue?.number ?? 0) + 1;
      const defaultColumn = await prisma.boardColumn.findFirst({
        where: { projectId, isDefault: true },
      });
      const issue = await prisma.issue.create({
        data: {
          projectId,
          number,
          title,
          body,
          type,
          priority,
          assigneeId,
          creatorId: userId,
          columnId: defaultColumn?.id,
        },
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { key: `${project.prefix}-${number}`, id: issue.id, title },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'add_comment',
    'Add a comment to an issue',
    { projectId: z.string(), issueNumber: z.number(), body: z.string() },
    async ({ projectId, issueNumber, body }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('add_comment', orgId);
      const issue = await prisma.issue.findUnique({
        where: { projectId_number: { projectId, number: issueNumber } },
      });
      if (!issue) return { content: [{ type: 'text' as const, text: 'Issue not found' }] };
      const comment = await prisma.comment.create({
        data: { issueId: issue.id, authorId: userId, body },
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(comment, null, 2) }] };
    },
  );

  server.tool(
    'update_issue',
    'Update an existing issue: change status (columnId), priority, assignee, labels, story points, or sprint',
    {
      projectId: z.string().describe('Project ID'),
      issueNumber: z.number().describe('Issue number within the project'),
      columnId: z
        .string()
        .optional()
        .describe('Board column ID to move the issue to (changes status)'),
      priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
      assigneeId: z.string().optional().describe('User ID to assign, or empty string to unassign'),
      labels: z.array(z.string()).optional().describe('Label names to set on the issue'),
      storyPoints: z.number().optional().describe('Story point estimate'),
      sprintId: z
        .string()
        .optional()
        .describe('Sprint ID to move issue to, or empty string to remove from sprint'),
    },
    async ({
      projectId,
      issueNumber,
      columnId,
      priority,
      assigneeId,
      labels,
      storyPoints,
      sprintId,
    }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('update_issue', orgId);
      const issue = await prisma.issue.findUnique({
        where: { projectId_number: { projectId, number: issueNumber } },
      });
      if (!issue) return { content: [{ type: 'text' as const, text: 'Issue not found' }] };

      const updateData: Record<string, unknown> = {};
      if (columnId !== undefined) updateData.column = { connect: { id: columnId } };
      if (priority !== undefined) updateData.priority = priority;
      if (assigneeId !== undefined) {
        updateData.assignee = assigneeId ? { connect: { id: assigneeId } } : { disconnect: true };
      }
      if (storyPoints !== undefined) updateData.storyPoints = storyPoints;
      if (sprintId !== undefined) {
        updateData.sprint = sprintId ? { connect: { id: sprintId } } : { disconnect: true };
      }
      if (labels !== undefined) {
        updateData.labels = {
          set: [],
          connectOrCreate: labels.map((name) => ({
            where: { projectId_name: { projectId, name } },
            create: { projectId, name },
          })),
        };
      }

      const updated = await prisma.issue.update({
        where: { id: issue.id },
        data: updateData,
        include: {
          project: { select: { prefix: true } },
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { name: true } },
          sprint: { select: { id: true, name: true } },
        },
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { ...updated, key: `${updated.project.prefix}-${updated.number}` },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'delete_issue',
    'Permanently delete an issue from a project',
    {
      projectId: z.string().describe('Project ID'),
      issueNumber: z.number().describe('Issue number within the project'),
    },
    async ({ projectId, issueNumber }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('delete_issue', orgId);
      try {
        await issuesService.deleteIssue(projectId, issueNumber, userId);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ deleted: true, issueNumber }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Delete failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Sprint tools

  server.tool(
    'list_sprints',
    'List sprints for a project, optionally filtered by status (PLANNING, ACTIVE, COMPLETED)',
    {
      projectId: z.string().describe('Project ID'),
      status: z
        .enum(['PLANNING', 'ACTIVE', 'COMPLETED'])
        .optional()
        .describe('Filter by sprint status'),
      cursor: z.string().optional().describe('Cursor for pagination (sprint ID to start after)'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    },
    async ({ projectId, status, cursor, limit }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('list_sprints', orgId);

      const where: Record<string, unknown> = { projectId };
      if (status) where.status = status;

      const take = Math.min(limit, 100);
      const sprints = await prisma.sprint.findMany({
        where,
        take: take + 1,
        include: { _count: { select: { issues: true } } },
        orderBy: { startDate: 'desc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = sprints.length > take;
      const page = hasMore ? sprints.slice(0, take) : sprints;
      const result: Record<string, unknown> = { data: page };
      if (hasMore) result.next_cursor = page[page.length - 1].id;
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'get_sprint',
    'Get a sprint with all its issues',
    {
      sprintId: z.string().describe('Sprint ID'),
    },
    async ({ sprintId }) => {
      const sprint = await prisma.sprint.findUnique({
        where: { id: sprintId },
        include: {
          project: { select: { prefix: true, team: { select: { orgId: true } } } },
          issues: {
            include: {
              assignee: { select: USER_BASIC_SELECT },
              labels: true,
              column: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!sprint) return { content: [{ type: 'text' as const, text: 'Sprint not found' }] };
      await assertMcpPermission('get_sprint', sprint.project.team.orgId);

      const result = {
        ...sprint,
        _storyPoints: sprint.issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
        issues: sprint.issues.map((i) => ({
          ...i,
          key: `${sprint.project.prefix}-${i.number}`,
        })),
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'create_sprint',
    'Create a new sprint in PLANNING status for a project',
    {
      projectId: z.string().describe('Project ID'),
      name: z.string().describe('Sprint name'),
      goal: z.string().optional().describe('Sprint goal'),
      startDate: z.string().describe('Start date (ISO 8601)'),
      endDate: z.string().describe('End date (ISO 8601)'),
    },
    async ({ projectId, name, goal, startDate, endDate }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('create_sprint', orgId);
      try {
        const sprint = await sprintsService.createSprint(projectId, {
          name,
          goal,
          startDate,
          endDate,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(sprint, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Create sprint failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    'start_sprint',
    'Start a sprint (move from PLANNING to ACTIVE). Only one active sprint per project is allowed.',
    {
      sprintId: z.string().describe('Sprint ID'),
    },
    async ({ sprintId }) => {
      const orgId = await getOrgIdFromSprint(sprintId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Sprint not found' }] };
      await assertMcpPermission('start_sprint', orgId);
      try {
        const sprint = await sprintsService.startSprint(sprintId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(sprint, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Start sprint failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    'complete_sprint',
    'Complete an active sprint. Incomplete issues can be moved to another sprint or backlog.',
    {
      sprintId: z.string().describe('Sprint ID'),
      moveToSprintId: z
        .string()
        .optional()
        .describe('Sprint ID to move incomplete issues to. Omit to move to backlog.'),
    },
    async ({ sprintId, moveToSprintId }) => {
      const orgId = await getOrgIdFromSprint(sprintId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Sprint not found' }] };
      await assertMcpPermission('complete_sprint', orgId);
      try {
        const sprint = await sprintsService.completeSprint(sprintId, moveToSprintId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(sprint, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Complete sprint failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    'add_issues_to_sprint',
    'Add one or more issues to a sprint by their issue IDs',
    {
      sprintId: z.string().describe('Sprint ID'),
      issueIds: z.array(z.string()).describe('Array of issue IDs to add to the sprint'),
    },
    async ({ sprintId, issueIds }) => {
      const orgId = await getOrgIdFromSprint(sprintId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Sprint not found' }] };
      await assertMcpPermission('add_issues_to_sprint', orgId);
      try {
        const sprint = await sprintsService.addIssuesToSprint(sprintId, issueIds);
        return { content: [{ type: 'text' as const, text: JSON.stringify(sprint, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Add issues to sprint failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}
