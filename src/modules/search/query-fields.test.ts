/**
 * The new query fields against the real database: what the compiler asks of Prisma, what the
 * evaluator reads from a hydrated issue, and the step that resolves names and keys for both.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../config/database';
import {
  compileToPrisma,
  evaluate,
  issueFieldRegistry,
  parse,
  type QueryContext,
} from '../../lib/query-engine';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { AUTOMATION_ISSUE_INCLUDE } from '../../utils/prisma-selects';
import { createRule, evaluateRules } from '../automation/automation.service';
import { setFieldValue } from '../custom-fields/custom-fields.service';
import { listIssues } from '../issues/issues.service';

import { resolveQueryFields, type QueryScope } from './query-fields.service';
import { searchIssues } from './search-queries.service';

const params = (userId: string, projectId?: string) => ({
  userId,
  projectId,
  limit: 50,
  offset: 0,
  type: 'issues',
  q: '',
});

describe('query fields', () => {
  let ctx: TestContext;
  let hidden: TestContext;
  let member: TestUser;
  let outsider: TestUser;
  let openColumn: string;
  let doneColumn: string;
  const ids: Record<string, string> = {};
  const numbers: Record<string, number> = {};
  const defs: Record<string, string> = {};
  let counter = 0;

  const makeIssue = async (
    name: string,
    data: { body?: string; columnId?: string; sprintId?: string; assigneeId?: string } = {},
  ) => {
    counter += 1;
    const issue = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 1000 + counter,
        title: `Issue ${name}`,
        body: data.body ?? '',
        creatorId: ctx.owner.id,
        columnId: data.columnId ?? openColumn,
        sprintId: data.sprintId,
        assigneeId: data.assigneeId,
      },
    });
    ids[name] = issue.id;
    numbers[name] = issue.number;
    return issue;
  };

  const link = (fromId: string, toId: string, type: 'BLOCKS' | 'IS_BLOCKED_BY' | 'RELATES_TO') =>
    prisma.issueLink.create({ data: { fromId, toId, type } });

  // The names of the matching issues of the test project, as the database answers
  const found = async (query: string, scope: QueryScope = { projectId: ctx.projectId }) => {
    const ast = parse(query);
    const context: QueryContext = {
      currentUserId: ctx.owner.id,
      projectId: ctx.projectId,
      ...(await resolveQueryFields(ast, scope)),
    };
    const where = compileToPrisma(ast, issueFieldRegistry, context);
    const rows = await prisma.issue.findMany({
      where: { AND: [{ projectId: ctx.projectId }, where] },
      select: { id: true },
    });
    const byId = Object.entries(ids);
    return rows.map((row) => byId.find(([, id]) => id === row.id)?.[0] ?? row.id).sort();
  };

  // The same question to the evaluator, over every issue hydrated as a rule sees it
  const evaluated = async (query: string) => {
    const ast = parse(query);
    const context: QueryContext = {
      currentUserId: ctx.owner.id,
      projectId: ctx.projectId,
      ...(await resolveQueryFields(ast, { projectId: ctx.projectId })),
    };
    const issues = await prisma.issue.findMany({
      where: { projectId: ctx.projectId },
      include: AUTOMATION_ISSUE_INCLUDE,
    });
    const byId = Object.entries(ids);
    return issues
      .filter((issue) =>
        evaluate(ast, issue as unknown as Record<string, unknown>, issueFieldRegistry, context),
      )
      .map((issue) => byId.find(([, id]) => id === issue.id)?.[0] ?? issue.id)
      .sort();
  };

  beforeAll(async () => {
    ctx = await createTestContext('query-fields');
    hidden = await createTestContext('query-fields-hidden');
    member = await addMemberToContext(ctx);
    outsider = await createTestUser();

    const columns = await prisma.boardColumn.findMany({ where: { projectId: ctx.projectId } });
    openColumn = columns.find((c) => !c.isDone)?.id ?? '';
    doneColumn =
      columns.find((c) => c.isDone)?.id ??
      (
        await prisma.boardColumn.create({
          data: { projectId: ctx.projectId, name: 'Finished', position: 99, isDone: true },
        })
      ).id;

    const sprint = await prisma.sprint.create({
      data: {
        projectId: ctx.projectId,
        name: 'Now',
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: new Date(),
      },
    });
    const planned = await prisma.sprint.create({
      data: {
        projectId: ctx.projectId,
        name: 'Later',
        status: 'PLANNING',
        startDate: new Date(),
        endDate: new Date(),
      },
    });

    await makeIssue('openBlocker', { sprintId: sprint.id });
    await makeIssue('doneBlocker', { columnId: doneColumn, sprintId: planned.id });
    await makeIssue('blockedByOpen', { body: 'the login form hangs' });
    await makeIssue('blockedByDone');
    await makeIssue('blockedOneSided');
    await makeIssue('plain', { body: 'a 100% literal _ body' });

    await link(ids.blockedByOpen, ids.openBlocker, 'IS_BLOCKED_BY');
    await link(ids.openBlocker, ids.blockedByOpen, 'BLOCKS');
    await link(ids.blockedByDone, ids.doneBlocker, 'IS_BLOCKED_BY');
    await link(ids.doneBlocker, ids.blockedByDone, 'BLOCKS');
    // A half-deleted pair: only the BLOCKS side is left
    await link(ids.openBlocker, ids.blockedOneSided, 'BLOCKS');
    await link(ids.plain, ids.doneBlocker, 'RELATES_TO');

    const define = async (name: string, type: string, projectId = ctx.projectId) => {
      const def = await prisma.customFieldDefinition.create({
        data: {
          projectId,
          name,
          type,
          options: type.endsWith('SELECT') ? ['High', 'Low'] : undefined,
        },
      });
      defs[`${projectId === ctx.projectId ? '' : 'hidden:'}${name}`] = def.id;
    };
    await define('Severity', 'SELECT');
    await define('Cost', 'NUMBER');
    await define('Ship date', 'DATE');
    await define('Notes', 'TEXT');
    await define('Owner', 'USER');
    await define('Areas', 'MULTI_SELECT');
    await define('Secret', 'TEXT', hidden.projectId);

    await setFieldValue(ids.plain, defs.Severity, 'High');
    await setFieldValue(ids.openBlocker, defs.Severity, 'Low');
    await setFieldValue(ids.plain, defs.Cost, '10');
    await setFieldValue(ids.openBlocker, defs.Cost, '9');
    await setFieldValue(ids.doneBlocker, defs.Cost, 'not a number');
    await setFieldValue(ids.plain, defs['Ship date'], '2026-03-01');
    await setFieldValue(ids.openBlocker, defs['Ship date'], '2026-01-01');
    await setFieldValue(ids.doneBlocker, defs['Ship date'], '2026-02-31');
    await setFieldValue(ids.plain, defs.Notes, 'needs a 100% second look');
    await setFieldValue(ids.blockedByDone, defs.Notes, '');
    await setFieldValue(ids.plain, defs.Owner, ctx.owner.id);
    await setFieldValue(ids.plain, defs.Areas, 'Api,Web');
    await setFieldValue(ids.openBlocker, defs.Areas, 'Web');
    await setFieldValue(ids.doneBlocker, defs.Areas, 'Webhooks,Api');
  });

  afterAll(async () => {
    await cleanupTestContext(hidden);
    await cleanupTestContext(ctx);
  });

  describe('blocked and blocks', () => {
    it('returns an issue blocked by an open issue, not one blocked by a done issue', async () => {
      const result = await found('blocked = true');
      expect(result).toContain('blockedByOpen');
      expect(result).not.toContain('blockedByDone');
    });

    it('counts a pair of which only the BLOCKS side is left', async () => {
      expect(await found('blocked = true')).toContain('blockedOneSided');
    });

    it('answers the inverse', async () => {
      const unblocked = await found('blocked = false');
      expect(unblocked).toContain('blockedByDone');
      expect(unblocked).not.toContain('blockedByOpen');
    });

    it('blocks needs the issue itself open, and a link from either side', async () => {
      const result = await found('blocks = true');
      expect(result).toEqual(['openBlocker']);
      expect(result).not.toContain('doneBlocker');
      const incoming = await makeIssue('blockerByIncoming');
      await link(ids.plain, incoming.id, 'IS_BLOCKED_BY');
      expect(await found('blocks = true')).toEqual(['blockerByIncoming', 'openBlocker']);
      expect(await found('blocks = false')).toContain('doneBlocker');
      await prisma.issueLink.deleteMany({ where: { toId: incoming.id } });
    });

    it('a blocker without a column is open', async () => {
      const loose = await makeIssue('looseBlocker');
      await prisma.issue.update({ where: { id: loose.id }, data: { columnId: null } });
      const blocked = await makeIssue('blockedByLoose');
      await link(blocked.id, loose.id, 'IS_BLOCKED_BY');
      expect(await found('blocked = true')).toContain('blockedByLoose');
    });
  });

  describe('linked', () => {
    it('finds issues with any link to a key, from both sides', async () => {
      const key = `${ctx.projectPrefix}-${numbers.doneBlocker}`;
      expect(await found(`linked = ${key}`, { userId: ctx.owner.id })).toEqual(
        expect.arrayContaining(['blockedByDone', 'plain']),
      );
      const incoming = await found(`linked = ${ctx.projectPrefix}-${numbers.blockedOneSided}`, {
        userId: ctx.owner.id,
      });
      expect(incoming).toEqual(['openBlocker']);
    });

    it('takes org/team/KEY quoted', async () => {
      const key = `${ctx.orgSlug}/${ctx.teamSlug}/${ctx.projectPrefix}-${numbers.blockedOneSided}`;
      expect(await found(`linked = "${key}"`, { userId: ctx.owner.id })).toEqual(['openBlocker']);
    });

    it('answers unseen and missing alike: nothing', async () => {
      const secret = await prisma.issue.create({
        data: {
          projectId: hidden.projectId,
          number: 1,
          title: 'Secret',
          body: '',
          creatorId: hidden.owner.id,
        },
      });
      await link(ids.plain, secret.id, 'RELATES_TO');
      const unseen = await resolveQueryFields(parse(`linked = ${hidden.projectPrefix}-1`), {
        userId: outsider.id,
      });
      const missing = await resolveQueryFields(parse(`linked = ${hidden.projectPrefix}-9999`), {
        userId: outsider.id,
      });
      expect([...(unseen.linkedIssues?.values() ?? [])]).toEqual([null]);
      expect([...(missing.linkedIssues?.values() ?? [])]).toEqual([null]);
      expect(await found(`linked = ${hidden.projectPrefix}-1`, { userId: member.id })).toEqual([]);
      const seen = await found(`linked = ${hidden.projectPrefix}-1`, { userId: hidden.owner.id });
      expect(seen).toEqual(['plain']);
      await prisma.issueLink.deleteMany({ where: { toId: secret.id } });
    });

    it('resolves a rule key inside the team of its project', async () => {
      const key = `${ctx.projectPrefix}-${numbers.blockedOneSided}`;
      expect(await found(`linked = ${key}`)).toEqual(['openBlocker']);
      const scoped = await resolveQueryFields(parse(`linked = ${hidden.projectPrefix}-1`), {
        projectId: ctx.projectId,
      });
      expect([...(scoped.linkedIssues?.values() ?? [])]).toEqual([null]);
    });

    it('refuses what is no issue key', async () => {
      const scopes: QueryScope[] = [{ userId: ctx.owner.id }, { projectId: ctx.projectId }];
      for (const scope of scopes) {
        await expect(resolveQueryFields(parse('linked = banana'), scope)).rejects.toThrow('key');
        await expect(resolveQueryFields(parse('linked = "a/b/c/d"'), scope)).rejects.toThrow('key');
      }
    });

    it('caps the keys of one query', async () => {
      const keys = Array.from({ length: 51 }, (_, i) => `AXM-${i + 1}`).join(', ');
      await expect(
        resolveQueryFields(parse(`linked IN (${keys})`), { userId: ctx.owner.id }),
      ).rejects.toThrow('50');
    });
  });

  describe('text', () => {
    it('matches a body-only hit', async () => {
      expect(await found('text ~ "login"')).toEqual(['blockedByOpen']);
    });

    it('matches the title, and takes % literally', async () => {
      expect(await found('text ~ "Issue plain"')).toEqual(['plain']);
      expect(await found('text ~ "100%"')).toEqual(['plain']);
      expect(await found('text ~ "_ body"')).toEqual(['plain']);
      expect(await found('text ~ "%"')).toEqual(['plain']);
    });
  });

  describe('done and sprintstate', () => {
    it('done', async () => {
      expect(await found('done = true')).toEqual(['doneBlocker']);
      expect(await found('done = false')).not.toContain('doneBlocker');
      expect(await found('done = false')).toContain('looseBlocker');
    });

    it('sprintstate', async () => {
      expect(await found('sprintstate = ACTIVE')).toEqual(['openBlocker']);
      expect(await found('sprintstate IN (ACTIVE, PLANNING)')).toEqual([
        'doneBlocker',
        'openBlocker',
      ]);
      expect(await found('sprintstate != ACTIVE')).toContain('plain');
      expect(await found('sprintstate != ACTIVE')).not.toContain('openBlocker');
      expect(await found('sprint = currentSprint()')).toEqual(['openBlocker']);
    });
  });

  describe('custom fields', () => {
    it('cf.Severity = High filters', async () => {
      expect(await found('cf.Severity = High')).toEqual(['plain']);
      expect(await found('cf.severity = "LOW"')).toEqual(['openBlocker']);
    });

    it('!= also holds for an issue without a value in a project with the field', async () => {
      const result = await found('cf.Severity != High');
      expect(result).toContain('openBlocker');
      expect(result).toContain('blockedByDone');
      expect(result).not.toContain('plain');
    });

    it('compares numbers by value, so 10 > 9, and survives a bad stored value', async () => {
      expect(await found('cf.Cost > 9')).toEqual(['plain']);
      expect(await found('cf.Cost >= 9')).toEqual(['openBlocker', 'plain']);
      expect(await found('cf.Cost < 10')).toEqual(['openBlocker']);
      expect(await found('cf.Cost = abc')).toEqual([]);
    });

    it('compares dates by value, and survives a bad stored value', async () => {
      expect(await found('cf."Ship date" > "2026-02-01"')).toEqual(['plain']);
      expect(await found('cf."Ship date" < now()')).toEqual(['openBlocker', 'plain']);
      expect(await found('cf."Ship date" > "soon"')).toEqual([]);
    });

    it('text, user and multi select', async () => {
      expect(await found('cf.Notes ~ "100%"')).toEqual(['plain']);
      expect(await found('cf.Notes != null')).toEqual(['plain']);
      expect(await found('cf.Notes = null')).toContain('blockedByDone');
      expect(await found('cf.Owner = currentUser()')).toEqual(['plain']);
      expect(await found('cf.Areas = Web')).toEqual(['openBlocker', 'plain']);
      expect(await found('cf.Areas = Api')).toEqual(['doneBlocker', 'plain']);
      expect(await found('cf.Areas != Web')).not.toContain('plain');
      expect(await found('cf.Areas != Web')).toContain('doneBlocker');
    });

    it('a value a rule wrote through set_field is compared by value too', async () => {
      const issue = await makeIssue('ruleWritten');
      await prisma.automationRule.create({
        data: {
          projectId: ctx.projectId,
          name: 'writes cost',
          trigger: 'label:added',
          actions: [{ type: 'set_field', field: 'custom:Cost', value: '100' }],
        },
      });
      await evaluateRules(ctx.projectId, 'label:added', {
        issue: await prisma.issue.findUniqueOrThrow({
          where: { id: issue.id },
          include: AUTOMATION_ISSUE_INCLUDE,
        }),
        actorId: ctx.owner.id,
        label: 'x',
      });
      await prisma.automationRule.deleteMany({
        where: { projectId: ctx.projectId, name: 'writes cost' },
      });
      expect(await found('cf.Cost > 99')).toEqual(['ruleWritten']);
    });

    it('unknown cf.Nope is an error naming Nope', async () => {
      await expect(found('cf.Nope = 1')).rejects.toThrow(/Nope/);
      await expect(found('cf.Nope = 1', { userId: ctx.owner.id })).rejects.toThrow(/Nope/);
    });

    it('a field only in a hidden project answers exactly like an unknown one', async () => {
      const message = async (name: string) =>
        resolveQueryFields(parse(`cf.${name} = 1`), { userId: member.id }).catch(
          (err: Error) => err.message,
        );
      const hiddenAnswer = await message('Secret');
      const unknownAnswer = await message('Sekret');
      expect(typeof hiddenAnswer).toBe('string');
      expect(hiddenAnswer).toEqual((unknownAnswer as string).replace('Sekret', 'Secret'));
      await expect(
        resolveQueryFields(parse('cf.Secret = 1'), { userId: hidden.owner.id }),
      ).resolves.toBeDefined();
    });

    it('holds its definitions as types, however many projects share a name', async () => {
      const fields = await resolveQueryFields(parse('cf.SEVERITY = 1'), {
        projectId: ctx.projectId,
      });
      expect(fields.customFields?.get('severity')).toEqual(['SELECT']);
    });

    it('asks nothing of the database for a query with neither', async () => {
      const spy = vi.spyOn(prisma.customFieldDefinition, 'findMany');
      await resolveQueryFields(parse('type = Bug'), { projectId: ctx.projectId });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('does not show its typed columns in a value that comes back', async () => {
      const row = await setFieldValue(ids.plain, defs.Cost, '10');
      expect(row).not.toHaveProperty('numberValue');
      expect(row).not.toHaveProperty('dateValue');
    });
  });

  describe('names as well as ids', () => {
    let named: string;
    let otherOrg: TestContext;

    beforeAll(async () => {
      const sprint = await prisma.sprint.create({
        data: {
          projectId: ctx.projectId,
          name: 'Named sprint',
          startDate: new Date(),
          endDate: new Date(),
        },
      });
      const issue = await makeIssue('named', { assigneeId: member.id, sprintId: sprint.id });
      named = issue.id;
      await setFieldValue(named, defs.Owner, member.id);
      // Another org, with the same prefix and an issue a member must never reach
      otherOrg = await createTestContext('query-fields-prefix');
      await prisma.project.update({
        where: { id: otherOrg.projectId },
        data: { prefix: ctx.projectPrefix },
      });
      await prisma.issue.create({
        data: {
          projectId: otherOrg.projectId,
          number: 1,
          title: 'Other org',
          body: '',
          creatorId: otherOrg.owner.id,
        },
      });
    });

    afterAll(async () => {
      await cleanupTestContext(otherOrg);
    });

    it('assignee and creator by username, any case, and by id', async () => {
      expect(await found(`assignee = "${member.username.toUpperCase()}"`)).toEqual(['named']);
      expect(await found(`assignee = "${member.id}"`)).toEqual(['named']);
      expect(await found(`assignee IN ("${member.username}", "nobody-here")`)).toEqual(['named']);
      expect(await found(`assignee != "${member.username}"`)).toContain('plain');
      expect(await found(`assignee != "${member.username}"`)).not.toContain('named');
      expect(await found(`creator = "${ctx.owner.username}"`)).toContain('plain');
      expect(await found('assignee = "nobody-here"')).toEqual([]);
    });

    it('sprint by name, and by id', async () => {
      expect(await found('sprint = "named SPRINT"')).toEqual(['named']);
      const sprint = await prisma.issue.findUniqueOrThrow({ where: { id: named } });
      expect(await found(`sprint = "${sprint.sprintId}"`)).toEqual(['named']);
      expect(await found('sprint != "Named sprint"')).toContain('plain');
    });

    it('project by prefix, and by id', async () => {
      const all = await found(`project = ${ctx.projectPrefix}`);
      expect(all).toContain('plain');
      expect(await found(`project = "${ctx.projectId}"`)).toEqual(all);
      expect(await found(`project != ${ctx.projectPrefix}`)).toEqual([]);
    });

    it('a USER custom field by username', async () => {
      expect(await found(`cf.Owner = "${member.username}"`)).toEqual(['named']);
      expect(await found(`cf.Owner = "${member.id}"`)).toEqual(['named']);
      expect(await found(`cf.Owner != "${member.username}"`)).toContain('plain');
      expect(await found('cf.Owner = "nobody-here"')).toEqual([]);
    });

    it('a prefix another org also uses reaches nothing outside what the caller sees', async () => {
      const q = `project = ${ctx.projectPrefix}`;
      const search = await searchIssues('', {}, params(member.id), q);
      const projects = new Set(
        (search.items as Array<{ projectId: string }>).map((item) => item.projectId),
      );
      expect([...projects]).toEqual([ctx.projectId]);
      const other = await searchIssues('', {}, params(otherOrg.owner.id), q);
      expect(
        new Set((other.items as Array<{ projectId: string }>).map((item) => item.projectId)),
      ).toEqual(new Set([otherOrg.projectId]));
      // An id of another org doesn't open it either, nor does != on the prefix
      const byId = await searchIssues(
        '',
        {},
        params(member.id),
        `project = "${otherOrg.projectId}"`,
      );
      expect(byId.items).toEqual([]);
      const negated = await searchIssues(
        '',
        {},
        params(member.id),
        `project != ${ctx.projectPrefix}`,
      );
      expect(negated.items).toEqual([]);
      const list = await listIssues(ctx.projectId, { q: `project = "${otherOrg.projectId}"` });
      expect(list.issues).toEqual([]);
      const listed = await listIssues(ctx.projectId, { q });
      expect(listed.issues.every((i: { projectId: string }) => i.projectId === ctx.projectId)).toBe(
        true,
      );
    });

    it('a rule fires on a name', async () => {
      const issue = await prisma.issue.findUniqueOrThrow({
        where: { id: named },
        include: AUTOMATION_ISSUE_INCLUDE,
      });
      const rule = await createRule(ctx.projectId, {
        name: 'by name',
        trigger: 'label:added',
        condition: `assignee = "${member.username}" AND project = ${ctx.projectPrefix} AND sprint = "Named sprint" AND cf.Owner = "${member.username}"`,
        actions: [{ type: 'add_label', name: 'fired-by-name' }],
      });
      await evaluateRules(ctx.projectId, 'label:added', {
        issue,
        actorId: ctx.owner.id,
        label: 'x',
      });
      await prisma.automationRule.delete({ where: { id: rule.id } });
      const after = await prisma.issue.findUniqueOrThrow({
        where: { id: named },
        include: { labels: true },
      });
      expect(after.labels.map((l) => l.name)).toContain('fired-by-name');
    });

    it('matches ~ on the name of an assignee, creator, sprint and project', async () => {
      expect(await found(`assignee ~ "${member.username.slice(1, -1)}"`)).toEqual(
        await found(`assignee = "${member.username}"`),
      );
      expect(await found(`assignee = "${member.username}"`)).not.toEqual([]);
      expect(await found('sprint ~ "NAMED"')).toEqual(['named']);
      expect(await found(`project ~ "${ctx.projectPrefix.slice(1)}"`)).toEqual(
        await found(`project = ${ctx.projectPrefix}`),
      );
      expect(await found(`creator ~ "${ctx.owner.username.slice(1, -1)}"`)).toEqual(
        await found(`creator = "${ctx.owner.username}"`),
      );
    });

    it('reads ~ currentUser() as = currentUser() on assignee and creator', async () => {
      const mine = await makeIssue('assignedToMe', { assigneeId: ctx.owner.id });
      try {
        expect(await found('assignee ~ currentUser()')).toEqual(['assignedToMe']);
        expect(await evaluated('assignee ~ currentUser()')).toEqual(['assignedToMe']);
        const created = await found('creator = currentUser()');
        expect(created).not.toEqual([]);
        expect(await found('creator ~ currentUser()')).toEqual(created);
        expect(await evaluated('creator ~ currentUser()')).toEqual(created);
      } finally {
        await prisma.issue.delete({ where: { id: mine.id } });
      }
    });

    it('agrees with the evaluator', async () => {
      const queries = [
        `assignee = "${member.username}"`,
        `assignee != "${member.username}"`,
        `assignee = "${member.id}"`,
        `assignee != "${member.id}"`,
        `assignee IN ("${member.username}", "nobody-here")`,
        `assignee NOT IN ("${member.username}")`,
        'assignee != currentUser()',
        `creator = "${ctx.owner.username}"`,
        `creator != "${ctx.owner.username}"`,
        'sprint = "Named sprint"',
        'sprint != "Named sprint"',
        'sprint IN ("Named sprint", "Now")',
        'sprint NOT IN ("Named sprint")',
        `project = ${ctx.projectPrefix}`,
        `project != ${ctx.projectPrefix}`,
        `project = "${ctx.projectId}"`,
        `project NOT IN (${ctx.projectPrefix})`,
        `assignee ~ "${member.username.slice(1, -1).toUpperCase()}"`,
        `NOT assignee ~ "${member.username.slice(1, -1)}"`,
        'assignee ~ "no-such-person"',
        'assignee ~ currentUser()',
        'NOT assignee ~ currentUser()',
        'creator ~ currentUser()',
        'NOT creator ~ currentUser()',
        `creator ~ "${ctx.owner.username.slice(1, -1)}"`,
        'sprint ~ "named"',
        'NOT sprint ~ "named"',
        'sprint ~ "no-such-sprint"',
        `project ~ "${ctx.projectPrefix.slice(1).toLowerCase()}"`,
        `NOT project ~ "${ctx.projectPrefix.slice(1)}"`,
        'project ~ "no-such-project"',
        'project ~ "%"',
        `cf.Owner = "${member.username}"`,
        `cf.Owner != "${member.username}"`,
        `cf.Owner IN ("${member.username}", "${ctx.owner.username}")`,
        'cf."Ship date" > 2026-02-01',
        'created > 2020-01-01',
      ];
      for (const query of queries) {
        expect(await found(query), query).toEqual(await evaluated(query));
      }
    });
  });

  it('an unquoted ISO date works on created and on a date custom field', async () => {
    expect(await found('cf."Ship date" > 2026-02-01')).toEqual(['plain']);
    expect(await found('created < 2020-01-01')).toEqual([]);
    expect(await found('created > 2020-01-01')).toContain('plain');
  });

  it('the database and the evaluator agree', async () => {
    const queries = [
      'blocked = true',
      'blocked = false',
      'blocks = true',
      'NOT blocks = true',
      'text ~ "login"',
      'text ~ "100%"',
      'done = true',
      'done != true',
      'sprintstate = ACTIVE',
      'sprintstate != ACTIVE',
      'sprintstate = null',
      'sprint = currentSprint()',
      'sprint != currentSprint()',
      'status = null',
      'label = null',
      'assignee = null',
      'cf.Severity = High',
      'cf.Severity != High',
      'cf.Cost > 9',
      'cf.Cost != 9',
      'cf.Cost = abc',
      'cf."Ship date" >= "2026-01-01"',
      'cf.Notes ~ "second"',
      'cf.Notes = null',
      'cf.Notes != null',
      'cf.Owner = currentUser()',
      'cf.Areas = Web',
      'cf.Areas != Web',
      'cf.Severity IN (High, Low)',
      'cf.Severity NOT IN (High, Low)',
      'linked = null',
      'linked != null',
      `linked = ${ctx.projectPrefix}-${numbers.blockedOneSided}`,
      `linked != ${ctx.projectPrefix}-${numbers.blockedOneSided}`,
    ];
    for (const query of queries) {
      expect(await found(query), query).toEqual(await evaluated(query));
    }
  });

  describe('through the searches', () => {
    it('search resolves within what the searcher sees, and answers 400 for the unknown', async () => {
      const result = await searchIssues('', {}, params(ctx.owner.id), 'cf.Severity = High');
      expect(result.items.map((i: { id: string }) => i.id)).toEqual([ids.plain]);
      await expect(searchIssues('', {}, params(member.id), 'cf.Secret = 1')).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('Secret'),
      });
      const empty = await searchIssues('', {}, params(outsider.id), 'cf.Severity = High').catch(
        (err: { statusCode: number }) => err.statusCode,
      );
      expect(empty).toBe(400);
    });

    it('search gives currentUser() its user', async () => {
      await makeIssue('mine', { assigneeId: member.id });
      const result = await searchIssues('', {}, params(member.id, ctx.projectId), 'assignee:@me');
      expect(result.items.map((i: { id: string }) => i.id).sort()).toEqual(
        [ids.mine, ids.named].sort(),
      );
    });

    it('search keeps the text after a spaced comparison', async () => {
      const result = await searchIssues(
        '',
        {},
        params(ctx.owner.id, ctx.projectId),
        'done = false hangs',
      );
      expect(result.items.map((i: { id: string }) => i.id)).toEqual([ids.blockedByOpen]);
    });

    it('the project list resolves, keeps its project, and gives currentUser() its user', async () => {
      const blocked = await listIssues(ctx.projectId, { q: 'blocked = true' });
      expect(blocked.issues.map((i: { id: string }) => i.id)).toContain(ids.blockedByOpen);
      const typed = await listIssues(ctx.projectId, { q: 'cf.Cost > 9' });
      expect(typed.issues.map((i: { id: string }) => i.id)).toContain(ids.plain);
      await expect(listIssues(ctx.projectId, { q: 'cf.Nope = 1' })).rejects.toMatchObject({
        statusCode: 400,
      });
      const q = 'assignee = currentUser()';
      const mine = await listIssues(ctx.projectId, { q, currentUserId: member.id });
      expect(mine.issues.map((i: { id: string }) => i.id).sort()).toEqual(
        [ids.mine, ids.named].sort(),
      );
      // The cached answer of one user is not another's
      const theirs = await listIssues(ctx.projectId, { q, currentUserId: ctx.owner.id });
      expect(theirs.issues).toEqual([]);
      // Without a user it matches nobody, not everybody unassigned
      const nobody = await listIssues(ctx.projectId, { q });
      expect(nobody.issues).toEqual([]);
    });

    it('old text still searches as text on a new field name', async () => {
      const result = await listIssues(ctx.projectId, { q: 'done:hangs' });
      expect(result.issues).toEqual([]);
    });
  });

  it('every write of a custom field value goes with its typed columns', () => {
    const writes: string[] = [];
    for (const root of ['src', 'scripts']) {
      for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
        if (!/\.ts$/.test(entry) || /\.test\.ts$/.test(entry)) continue;
        const source = readFileSync(join(root, entry), 'utf8');
        const calls = source.split(
          /customFieldValue\.(?:create|createMany|update|updateMany|upsert)\(/,
        );
        for (const call of calls.slice(1)) {
          // The arguments of the call: up to the first line closing it
          const args = call.slice(0, call.indexOf('\n  })') === -1 ? 400 : call.indexOf('\n  })'));
          if (!args.includes('typedCustomFieldValue')) writes.push(join(root, entry));
        }
      }
    }
    expect(writes).toEqual([]);
  });

  describe('automation', () => {
    const rulePath = {
      name: 'q',
      trigger: 'label:added' as const,
      actions: [{ type: 'add_label' as const, name: 'fired' }],
    };

    it('creating a rule refuses an unknown custom field, naming it', async () => {
      await expect(
        createRule(ctx.projectId, { ...rulePath, condition: 'cf.Nope = 1' }),
      ).rejects.toThrow(/Nope/);
      const rule = await createRule(ctx.projectId, {
        ...rulePath,
        condition: 'cf.Severity = High',
      });
      await prisma.automationRule.delete({ where: { id: rule.id } });
    });

    it('a rule fires on a custom field and on blocked', async () => {
      const fire = async (condition: string, name: string) => {
        const rule = await createRule(ctx.projectId, {
          ...rulePath,
          condition,
          actions: [{ type: 'add_label', name: `fired-${name}` }],
        });
        const issue = await prisma.issue.findUniqueOrThrow({
          where: { id: ids[name] },
          include: AUTOMATION_ISSUE_INCLUDE,
        });
        await evaluateRules(ctx.projectId, 'label:added', {
          issue,
          actorId: ctx.owner.id,
          label: 'x',
        });
        await prisma.automationRule.delete({ where: { id: rule.id } });
        const after = await prisma.issue.findUniqueOrThrow({
          where: { id: ids[name] },
          include: { labels: true },
        });
        return after.labels.some((l) => l.name === `fired-${name}`);
      };
      expect(await fire('cf.Cost > 9', 'plain')).toBe(true);
      expect(await fire('cf.Cost > 10', 'blockedByDone')).toBe(false);
      expect(await fire('blocked = true', 'blockedByOpen')).toBe(true);
      expect(await fire('blocked = true', 'blockedByDone')).toBe(false);
    });

    it('a template reads none of the hydration that only conditions need', async () => {
      const rule = await createRule(ctx.projectId, {
        ...rulePath,
        actions: [
          {
            type: 'add_comment',
            body: 'x[{{issue.linksFrom}}{{issue.linksTo}}{{issue.customFieldValues}}]',
          },
        ],
      });
      const issue = await prisma.issue.findUniqueOrThrow({
        where: { id: ids.plain },
        include: AUTOMATION_ISSUE_INCLUDE,
      });
      await evaluateRules(ctx.projectId, 'label:added', {
        issue,
        actorId: ctx.owner.id,
        label: 'x',
      });
      await prisma.automationRule.delete({ where: { id: rule.id } });
      const comment = await prisma.comment.findFirst({
        where: { issueId: ids.plain },
        orderBy: { createdAt: 'desc' },
      });
      expect(comment?.body).toBe('x[]');
    });
  });
});
