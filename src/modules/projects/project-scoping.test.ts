/**
 * Ids nested under /:projectId, and ids passed in bodies, must belong to that project.
 * The attacker owns project B in their own org and points B's routes at org A's records.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';
import { authDel, authGet, authPatch, authPost } from '../../test/helpers';
import { evaluateRules } from '../automation/automation.service';

describe('Project-scoped ids', () => {
  let a: TestContext;
  let b: TestContext;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    a = await createTestContext(`scopea${Date.now()}`);
    b = await createTestContext(`scopeb${Date.now()}`);
    const sprint = await prisma.sprint.create({
      data: {
        projectId: a.projectId,
        name: 'A sprint',
        startDate: new Date(),
        endDate: new Date(Date.now() + 86_400_000),
      },
    });
    ids.sprint = sprint.id;
    const [i1, i2] = await Promise.all(
      [1, 2].map((n) =>
        prisma.issue.create({
          data: {
            projectId: a.projectId,
            number: n,
            title: `A${n}`,
            body: '',
            creatorId: a.owner.id,
          },
        }),
      ),
    );
    ids.issue = i1.id;
    ids.link = (
      await prisma.issueLink.create({ data: { fromId: i1.id, toId: i2.id, type: 'RELATES_TO' } })
    ).id;
    ids.automation = (
      await prisma.automationRule.create({
        data: { projectId: a.projectId, name: 'A rule', trigger: 'issue:created', actions: [] },
      })
    ).id;
    const cols = await prisma.boardColumn.findMany({ where: { projectId: a.projectId }, take: 2 });
    ids.workflow = (
      await prisma.workflowRule.create({
        data: { projectId: a.projectId, fromColumnId: cols[0].id, toColumnId: cols[1].id },
      })
    ).id;
    ids.milestone = (
      await prisma.milestone.create({ data: { projectId: a.projectId, title: 'A milestone' } })
    ).id;
    const form = await prisma.form.create({
      data: {
        projectId: a.projectId,
        name: 'A form',
        slug: `a-form-${Date.now()}`,
        createdById: a.owner.id,
      },
    });
    ids.formPage = (
      await prisma.formPage.create({ data: { formId: form.id, title: 'P', position: 0 } })
    ).id;
    ids.form = form.id;
    // B needs an issue of its own for body references
    await prisma.issue.create({
      data: { projectId: b.projectId, number: 1, title: 'B1', body: '', creatorId: b.owner.id },
    });
    ids.bSprint = (
      await prisma.sprint.create({
        data: {
          projectId: b.projectId,
          name: 'B sprint',
          status: 'ACTIVE',
          startDate: new Date(),
          endDate: new Date(Date.now() + 86_400_000),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupTestContext(a);
    await cleanupTestContext(b);
  });

  it("refuses org A's records through project B's routes", async () => {
    const t = b.owner.token;
    const P = `/api/projects/${b.projectId}`;
    const results = await Promise.all([
      authGet(`${P}/sprints/${ids.sprint}`, t),
      authPatch(`${P}/sprints/${ids.sprint}`, t, { name: 'pwned' }),
      authPost(`${P}/sprints/${ids.sprint}/start`, t),
      authDel(`${P}/sprints/${ids.sprint}/issues/${ids.issue}`, t),
      authGet(`${P}/sprints/${ids.sprint}/report`, t),
      authPatch(`${P}/automation-rules/${ids.automation}`, t, { name: 'pwned' }),
      authPost(`${P}/automation-rules/${ids.automation}/toggle`, t),
      authDel(`${P}/workflow-rules/${ids.workflow}`, t),
      authDel(`${P}/issues/1/links/${ids.link}`, t),
      authPatch(`${P}/forms/${ids.form}/pages/${ids.formPage}`, t, { title: 'pwned' }),
    ]);
    const leaks = results
      .map((r, i) => ({ i, status: r.status }))
      .filter((r) => r.status !== 404 && r.status !== 403);
    expect(leaks).toEqual([]);

    expect((await prisma.sprint.findUniqueOrThrow({ where: { id: ids.sprint } })).name).toBe(
      'A sprint',
    );
    expect(await prisma.issueLink.count({ where: { id: ids.link } })).toBe(1);
    expect(await prisma.workflowRule.count({ where: { id: ids.workflow } })).toBe(1);
    expect(
      (await prisma.automationRule.findUniqueOrThrow({ where: { id: ids.automation } })).enabled,
    ).toBe(true);
    expect((await prisma.formPage.findUniqueOrThrow({ where: { id: ids.formPage } })).title).toBe(
      'P',
    );
  });

  it('refuses milestones of a project the user cannot access', async () => {
    const t = b.owner.token;
    const results = await Promise.all([
      authGet(`/api/projects/${a.projectId}/milestones`, t),
      authPost(`/api/projects/${a.projectId}/milestones`, t, { title: 'x' }),
      authGet(`/api/projects/milestones/${ids.milestone}`, t),
      authPatch(`/api/projects/milestones/${ids.milestone}`, t, { title: 'pwned' }),
      authDel(`/api/projects/milestones/${ids.milestone}`, t),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: ids.milestone } })).title).toBe(
      'A milestone',
    );
  });

  it("refuses body references to org A's records", async () => {
    const t = b.owner.token;
    const P = `/api/projects/${b.projectId}`;
    const link = await authPost(`${P}/issues/1/links`, t, {
      targetProjectId: a.projectId,
      targetIssueNumber: 1,
      type: 'RELATES_TO',
    });
    const update = await authPatch(`${P}/issues/1`, t, { sprintId: ids.sprint });
    const complete = await authPost(`${P}/sprints/${ids.bSprint}/complete`, t, {
      moveToSprintId: ids.sprint,
    });
    expect([link.status, update.status, complete.status].every((s) => s >= 400 && s < 500)).toBe(
      true,
    );
    expect(JSON.stringify(link.body)).not.toContain('A1');
    expect(await prisma.issue.count({ where: { sprintId: ids.sprint } })).toBe(0);
  });

  it("refuses to move an issue onto another project's board column", async () => {
    const foreignColumn = await prisma.boardColumn.findFirstOrThrow({
      where: { projectId: a.projectId },
    });
    const res = await authPatch(`/api/projects/${b.projectId}/issues/1/move`, b.owner.token, {
      columnId: foreignColumn.id,
      position: 0,
    });
    expect(res.status).toBe(400);
    const issue = await prisma.issue.findFirstOrThrow({
      where: { projectId: b.projectId, number: 1 },
    });
    expect(issue.columnId).not.toBe(foreignColumn.id);
  });

  it('W: refuses an assignee who is not on the project team', async () => {
    const t = b.owner.token;
    const P = `/api/projects/${b.projectId}`;
    const outsider = a.owner.id;
    const create = await authPost(`${P}/issues`, t, { title: 'x', assigneeId: outsider });
    const update = await authPatch(`${P}/issues/1`, t, { assigneeId: outsider });
    const issue = await prisma.issue.findFirstOrThrow({
      where: { projectId: b.projectId, number: 1 },
    });
    const bulk = await authPatch(`${P}/issues/bulk`, t, {
      issueIds: [issue.id],
      updates: { assigneeId: outsider },
    });
    expect([create.status, update.status, bulk.status]).toEqual([400, 400, 400]);
    expect(
      await prisma.issue.count({ where: { assigneeId: outsider, projectId: b.projectId } }),
    ).toBe(0);
    // A team member, or no one, is fine
    expect((await authPatch(`${P}/issues/1`, t, { assigneeId: b.owner.id })).status).toBe(200);
  });

  it('7: automation rules may not set a foreign column or a non-member assignee', async () => {
    const P = `/api/projects/${b.projectId}`;
    const foreignColumn = await prisma.boardColumn.findFirstOrThrow({
      where: { projectId: a.projectId },
    });
    const badStatus = await authPost(`${P}/automation-rules`, b.owner.token, {
      name: 'foreign column',
      trigger: 'issue:created',
      actions: [{ type: 'set_status', columnId: foreignColumn.id }],
    });
    const badAssignee = await authPost(`${P}/automation-rules`, b.owner.token, {
      name: 'stranger',
      trigger: 'issue:created',
      actions: [{ type: 'set_assignee', userId: a.owner.id }],
    });
    expect([badStatus.status, badAssignee.status]).toEqual([400, 400]);

    // A rule saved before (or whose assignee left the team) is checked again when it runs
    const rule = await prisma.automationRule.create({
      data: {
        projectId: b.projectId,
        name: 'stale',
        trigger: 'issue:created',
        actions: [{ type: 'set_assignee', userId: a.owner.id }],
      },
    });
    const target = await prisma.issue.findFirstOrThrow({
      where: { projectId: b.projectId, number: 1 },
    });
    await evaluateRules(b.projectId, 'issue:created', {
      issue: target,
      actorId: b.owner.id,
    } as never);
    await prisma.automationRule.delete({ where: { id: rule.id } });
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: target.id } });
    expect(issue.assigneeId).not.toBe(a.owner.id);
  });

  it('N1: set_field only writes plain content fields and custom fields', async () => {
    const P = `/api/projects/${b.projectId}`;
    const foreignColumn = await prisma.boardColumn.findFirstOrThrow({
      where: { projectId: a.projectId },
    });
    const bad = [
      { field: 'columnId', value: foreignColumn.id },
      { field: 'projectId', value: a.projectId },
      { field: 'assigneeId', value: a.owner.id },
      { field: 'creatorId', value: a.owner.id },
      { field: 'sprintId', value: 'x' },
      { field: 'priority', value: 'NOT_A_PRIORITY' },
    ];
    const statuses: number[] = [];
    for (const action of bad) {
      const res = await authPost(`${P}/automation-rules`, b.owner.token, {
        name: `bad ${action.field}`,
        trigger: 'issue:created',
        actions: [{ type: 'set_field', ...action }],
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual(bad.map(() => 400));

    // A rule stored before the check is refused at run time too
    const target = await prisma.issue.findFirstOrThrow({
      where: { projectId: b.projectId, number: 1 },
    });
    const stale = await prisma.automationRule.create({
      data: {
        projectId: b.projectId,
        name: 'stale set_field',
        trigger: 'issue:created',
        actions: [{ type: 'set_field', field: 'projectId', value: a.projectId }],
      },
    });
    await evaluateRules(b.projectId, 'issue:created', {
      issue: target,
      actorId: b.owner.id,
    } as never);
    await prisma.automationRule.delete({ where: { id: stale.id } });
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: target.id } })).projectId).toBe(
      b.projectId,
    );

    // Allowed: a content field and a custom field of the project
    const field = await prisma.customFieldDefinition.create({
      data: { projectId: b.projectId, name: `Env${Date.now()}`, type: 'TEXT' },
    });
    const ok = await authPost(`${P}/automation-rules`, b.owner.token, {
      name: 'ok',
      trigger: 'issue:created',
      actions: [
        { type: 'set_field', field: 'priority', value: 'HIGH' },
        { type: 'set_field', field: `custom:${field.name}`, value: 'prod' },
      ],
    });
    expect(ok.status).toBe(201);
    await evaluateRules(b.projectId, 'issue:created', {
      issue: target,
      actorId: b.owner.id,
    } as never);
    await prisma.automationRule.delete({ where: { id: ok.body.id } });
    const after = await prisma.issue.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.priority).toBe('HIGH');
    const value = await prisma.customFieldValue.findUnique({
      where: { issueId_fieldDefinitionId: { issueId: target.id, fieldDefinitionId: field.id } },
    });
    expect(value?.value).toBe('prod');
  });
});
