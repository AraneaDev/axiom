/**
 * Project settings and the public forms as registry actions (plan 4, task 3b): what waits for a
 * person when a token asks, with the preview the approver reads, and what the migration changed
 * around the public form pages and the search routes.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authGet, authPost } from '../../test/helpers';
import { tokenHeaderFor } from '../../test/mcp-client';
import { getSiteSettings, updateSiteSettings } from '../site-settings/site-settings.service';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('project settings as registry actions', () => {
  let ctx: TestContext;
  let member: TestUser;
  let token: string;
  let from: { id: string; name: string };
  let to: { id: string; name: string };
  let P: string;

  /**
   * A request with the owner's token.
   * @param method - The HTTP method
   * @param path - The path
   * @param body - The body, if any
   */
  function asToken(method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) {
    const call = request(app)[method](path).set('Authorization', token).set(XHR);
    return body ? call.send(body) : call;
  }

  beforeAll(async () => {
    ctx = await createTestContext('settings3b');
    member = await addMemberToContext(ctx);
    token = await tokenHeaderFor(ctx.owner, undefined, 'settings-agent');
    P = `/api/projects/${ctx.projectId}`;
    const stamp = Date.now();
    [from, to] = await Promise.all(
      ['from', 'to'].map((part, i) =>
        prisma.boardColumn.create({
          data: { projectId: ctx.projectId, name: `${part}-${stamp}`, position: 700 + i },
        }),
      ),
    );
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: member.id } });
  });

  describe('workflow rules', () => {
    it('hold a token create, change and delete for approval, with a preview', async () => {
      const create = await asToken('post', `${P}/workflow-rules`, {
        fromColumnId: from.id,
        toColumnId: to.id,
      });
      expect(create.status).toBe(202);
      expect(create.body.preview).toContain(`from column "${from.name}" to column "${to.name}"`);
      expect(await prisma.workflowRule.count({ where: { projectId: ctx.projectId } })).toBe(0);

      const rule = await prisma.workflowRule.create({
        data: { projectId: ctx.projectId, fromColumnId: from.id, toColumnId: to.id },
      });
      const change = await asToken('patch', `${P}/workflow-rules/${rule.id}`, {
        toColumnId: from.id,
      });
      expect(change.status).toBe(202);
      expect(change.body.preview).toContain('Change the workflow rule');
      const drop = await asToken('delete', `${P}/workflow-rules/${rule.id}`);
      expect(drop.status).toBe(202);
      expect(drop.body.preview).toContain(`Delete the workflow rule from column "${from.name}"`);
      expect(await prisma.workflowRule.count({ where: { id: rule.id } })).toBe(1);
      await prisma.workflowRule.delete({ where: { id: rule.id } });
    });

    it('answer 404 for a rule that is not in the project, before any preview', async () => {
      const res = await asToken('delete', `${P}/workflow-rules/nope`);
      expect(res.status).toBe(404);
    });
  });

  describe('approval gates and votes', () => {
    it('hold a token create, change and delete of a gate, and a vote, for approval', async () => {
      const create = await asToken('post', `${P}/approval-gates`, {
        fromColumnId: from.id,
        toColumnId: to.id,
        minApprovals: 2,
      });
      expect(create.status).toBe(202);
      expect(create.body.preview).toContain('needing 2 approvals, self-approval not allowed');

      const gate = await prisma.approvalGate.create({
        data: { projectId: ctx.projectId, fromColumnId: from.id, toColumnId: to.id },
      });
      const change = await asToken('patch', `${P}/approval-gates/${gate.id}`, { enabled: false });
      expect(change.status).toBe(202);
      expect(change.body.preview).toContain('is switched off (now on)');

      const issue = await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 4100,
          title: 'Waits for the vote',
          body: '',
          creatorId: ctx.owner.id,
          columnId: from.id,
        },
      });
      const pending = await prisma.approvalRequest.create({
        data: {
          issueId: issue.id,
          approvalGateId: gate.id,
          targetColumnId: to.id,
          requestedById: member.id,
          approverIds: [ctx.owner.id],
        },
      });
      const vote = await asToken('post', `/api/approval-requests/${pending.id}/vote`, {
        decision: 'REJECTED',
      });
      expect(vote.status).toBe(202);
      expect(vote.body.preview).toContain(
        `Vote REJECTED on the request to move ${ctx.projectPrefix}-4100 "Waits for the vote"`,
      );
      expect(await prisma.approvalVote.count({ where: { approvalRequestId: pending.id } })).toBe(0);

      const drop = await asToken('delete', `${P}/approval-gates/${gate.id}`);
      expect(drop.status).toBe(202);
      expect(drop.body.preview).toContain('cancelling its 1 pending request as of this request');
      expect(await prisma.approvalGate.count({ where: { id: gate.id } })).toBe(1);
    });

    it('lets a session vote and cancel as before: only the asked approver may decide', async () => {
      const gate = await prisma.approvalGate.create({
        data: { projectId: ctx.projectId, fromColumnId: to.id, toColumnId: from.id },
      });
      const issue = await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 4101,
          title: 'Session vote',
          body: '',
          creatorId: ctx.owner.id,
          columnId: to.id,
        },
      });
      const pending = await prisma.approvalRequest.create({
        data: {
          issueId: issue.id,
          approvalGateId: gate.id,
          targetColumnId: from.id,
          requestedById: ctx.owner.id,
          approverIds: [ctx.owner.id],
        },
      });
      const refused = await authPost(`/api/approval-requests/${pending.id}/vote`, member.token, {
        decision: 'APPROVED',
      });
      expect(refused.status).toBeGreaterThanOrEqual(400);
      const cancelled = await authPost(
        `/api/approval-requests/${pending.id}/cancel`,
        ctx.owner.token,
      );
      expect(cancelled.status).toBe(204);
    });
  });

  describe('automation rules', () => {
    it('let a token create, change and switch a rule without waiting, and hold the delete', async () => {
      const create = await asToken('post', `${P}/automation-rules`, {
        name: 'Label new bugs',
        trigger: 'issue:created',
        actions: [{ type: 'add_label', name: 'triage' }],
      });
      expect(create.status).toBe(201);
      const id = create.body.id as string;
      const change = await asToken('patch', `${P}/automation-rules/${id}`, { name: 'Label bugs' });
      expect(change.status).toBe(200);
      const toggled = await asToken('post', `${P}/automation-rules/${id}/toggle`);
      expect(toggled.status).toBe(200);
      expect(toggled.body.enabled).toBe(false);
      const drop = await asToken('delete', `${P}/automation-rules/${id}`);
      expect(drop.status).toBe(202);
      expect(drop.body.preview).toBe(
        `Delete the disabled automation rule "Label bugs" of project ${ctx.projectPrefix}`,
      );
    });

    it('refuses a trigger or an action type it does not know', async () => {
      const badTrigger = await asToken('post', `${P}/automation-rules`, {
        name: 'x',
        trigger: 'issue:exploded',
        actions: [],
      });
      expect(badTrigger.status).toBe(400);
      const badAction = await asToken('post', `${P}/automation-rules`, {
        name: 'x',
        trigger: 'issue:created',
        actions: [{ type: 'format_disk' }],
      });
      expect(badAction.status).toBe(400);
    });
  });

  describe('forms', () => {
    it('hold the delete of a form, a page and a field for approval, with a preview', async () => {
      const slug = `settings-form-${Date.now()}`;
      const created = await asToken('post', `${P}/forms`, { name: 'Contact', slug });
      expect(created.status).toBe(201);
      const formId = created.body.id as string;
      const page = await asToken('post', `${P}/forms/${formId}/pages`, { title: 'First' });
      expect(page.status).toBe(201);
      const field = await asToken('post', `${P}/forms/${formId}/pages/${page.body.id}/fields`, {
        type: 'TEXT',
        label: 'Your name',
      });
      expect(field.status).toBe(201);
      const reorder = await asToken('post', `${P}/forms/${formId}/pages/reorder`, {
        pageIds: [page.body.id],
      });
      expect(reorder.status).toBe(200);

      const dropField = await asToken(
        'delete',
        `${P}/forms/${formId}/pages/${page.body.id}/fields/${field.body.id}`,
      );
      expect(dropField.status).toBe(202);
      expect(dropField.body.preview).toBe(
        `Delete the TEXT field "Your name" on the page "First" of the form ${slug} in project ` +
          ctx.projectPrefix,
      );
      const dropPage = await asToken('delete', `${P}/forms/${formId}/pages/${page.body.id}`);
      expect(dropPage.body.preview).toContain('with its 1 field as of this request');
      const dropForm = await asToken('delete', `${P}/forms/${formId}`);
      expect(dropForm.status).toBe(202);
      expect(dropForm.body.preview).toContain(`Delete the DRAFT form ${slug} "Contact"`);
      expect(await prisma.form.count({ where: { id: formId } })).toBe(1);
    });

    it('answers 404 for a page that belongs to another project', async () => {
      const foreign = await createTestContext('settings3b-other');
      try {
        const form = await prisma.form.create({
          data: {
            projectId: foreign.projectId,
            name: 'Foreign',
            slug: `foreign-${Date.now()}`,
            createdById: foreign.owner.id,
          },
        });
        const page = await prisma.formPage.create({
          data: { formId: form.id, title: 'Theirs', position: 0 },
        });
        const own = await prisma.form.create({
          data: {
            projectId: ctx.projectId,
            name: 'Own',
            slug: `own-${Date.now()}`,
            createdById: ctx.owner.id,
          },
        });
        const res = await request(app)
          .patch(`${P}/forms/${own.id}/pages/${page.id}`)
          .set('Authorization', `Bearer ${ctx.owner.token}`)
          .set(XHR)
          .send({ title: 'Taken' });
        expect(res.status).toBe(404);
        expect((await prisma.formPage.findUniqueOrThrow({ where: { id: page.id } })).title).toBe(
          'Theirs',
        );
      } finally {
        await cleanupTestContext(foreign);
      }
    });
  });

  describe('reorder lists', () => {
    it.each([
      [
        'columns',
        'patch',
        () => `${P}/board/columns/reorder`,
        (ids: string[]) => ({ positions: ids.map((id, position) => ({ id, position })) }),
      ],
      [
        'roadmap buckets',
        'post',
        () => `${P}/roadmap/buckets/reorder`,
        (ids: string[]) => ({ bucketIds: ids }),
      ],
      [
        'form pages',
        'post',
        (formId: string) => `${P}/forms/${formId}/pages/reorder`,
        (ids: string[]) => ({ pageIds: ids }),
      ],
      [
        'form fields',
        'post',
        (formId: string) => `${P}/forms/${formId}/fields/reorder`,
        (ids: string[]) => ({ fieldIds: ids }),
      ],
    ] as const)('refuse more than 500 %s in one call', async (_name, method, pathFor, body) => {
      const form = await prisma.form.create({
        data: {
          projectId: ctx.projectId,
          name: 'Reorder',
          slug: `reorder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          createdById: ctx.owner.id,
        },
      });
      const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);
      const call = request(app)[method](pathFor(form.id));
      const res = await call
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set(XHR)
        .send(body(ids));
      expect(res.status).toBe(400);
    });
  });

  describe('the public form pages', () => {
    let enforced: boolean;
    const slug = `public-3b-${Date.now()}`;

    beforeAll(async () => {
      enforced = (await getSiteSettings()).enforce2fa;
      await prisma.form.create({
        data: {
          projectId: ctx.projectId,
          name: 'Open form',
          slug,
          createdById: ctx.owner.id,
          status: 'PUBLISHED',
        },
      });
    });

    afterAll(async () => {
      await updateSiteSettings({ enforce2fa: enforced });
    });

    it('stay open to a session without two-factor while the site enforces it', async () => {
      await updateSiteSettings({ enforce2fa: true });
      const page = await request(app)
        .get(`/api/f/${slug}`)
        .set('Authorization', `Bearer ${member.token}`);
      expect(page.status).toBe(200);
      expect(page.body.name).toBe('Open form');
      const blocked = await authGet(`${P}/forms`, ctx.owner.token);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
      await updateSiteSettings({ enforce2fa: false });
    });

    it('are not open to a token by name', async () => {
      const byName = await request(app)
        .post('/api/act')
        .set('Authorization', token)
        .set(XHR)
        .send({ action: 'publicForm.submit', input: { slug, data: {} } });
      expect(byName.status).toBe(403);
    });

    it('answer a submission with 201 and the id and status only', async () => {
      const res = await request(app).post(`/api/f/${slug}/submit`).set(XHR).send({ data: {} });
      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(['id', 'status']);
    });
  });

  describe('search', () => {
    it('cuts the sections to the areas a token covers, and refuses it the saved searches', async () => {
      const wikiOnly = await tokenHeaderFor(ctx.owner, ['search:read', 'wiki:read'], 'wiki-only');
      const found = await request(app)
        .get('/api/search')
        .query({ q: 'anything' })
        .set('Authorization', wikiOnly);
      expect(found.status).toBe(200);
      expect(found.body.map((section: { type: string }) => section.type)).toEqual(['wiki']);

      const saved = await request(app)
        .post('/api/search/saved')
        .set('Authorization', token)
        .set(XHR)
        .send({ name: 'Mine', query: { q: 'bug' } });
      expect(saved.status).toBe(403);
      const own = await authPost('/api/search/saved', ctx.owner.token, {
        name: 'Mine',
        query: { q: 'bug' },
      });
      expect(own.status).toBe(201);
      const drop = await request(app)
        .delete(`/api/search/saved/${own.body.id}`)
        .set('Authorization', token)
        .set(XHR);
      expect(drop.status).toBe(403);
      expect(await prisma.savedFilter.count({ where: { id: own.body.id } })).toBe(1);
    });
  });
});
