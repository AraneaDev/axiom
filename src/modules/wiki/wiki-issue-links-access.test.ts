/**
 * Wiki-issue links only connect, and only show, what the user could open: no linking or
 * mentioning issues of other orgs or of projects the author isn't on, and no link lists
 * that reveal issues or pages the viewer can't see.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authGet, authPost } from '../../test/helpers';

import { getLinksForIssue, getLinksForPage } from './wiki-issue-links.service';
import { updatePage } from './wiki.service';

describe('Wiki-issue link access', () => {
  let a: TestContext;
  let b: TestContext;
  let member: TestUser;
  let orgOnly: TestUser;
  let spaceId: string;
  let pageId: string;
  let foreignIssueId: string;
  let ownIssueId: string;
  const SECRET = `Linked-${Date.now()}`;

  beforeAll(async () => {
    a = await createTestContext(`wil${Date.now()}`);
    b = await createTestContext(`wilx${Date.now()}`);
    member = await addMemberToContext(a);
    orgOnly = await createTestUser();
    await prisma.orgMembership.create({
      data: { orgId: a.orgId, userId: orgOnly.id, role: 'MEMBER' },
    });
    const space = await prisma.wikiSpace.create({
      data: { teamId: a.teamId, name: 'L', slug: 'l' },
    });
    spaceId = space.id;
    pageId = (await prisma.page.create({ data: { spaceId, title: 'P', slug: 'p', body: '' } })).id;
    ownIssueId = (
      await prisma.issue.create({
        data: {
          projectId: a.projectId,
          number: 1,
          title: `${SECRET} own`,
          body: '',
          creatorId: a.owner.id,
        },
      })
    ).id;
    foreignIssueId = (
      await prisma.issue.create({
        data: {
          projectId: b.projectId,
          number: 1,
          title: `${SECRET} foreign`,
          body: '',
          creatorId: b.owner.id,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupTestContext(a);
    await cleanupTestContext(b);
    await prisma.user.deleteMany({ where: { id: { in: [member.id, orgOnly.id] } } });
  });

  it("L: refuses to link a page to another org's issue", async () => {
    const res = await authPost(`/api/wiki/pages/${pageId}/linked-issues`, member.token, {
      issueId: foreignIssueId,
      linkType: 'EMBED',
    });
    expect(res.status).toBe(403);
    expect(await prisma.wikiPageIssueLink.count({ where: { issueId: foreignIssueId } })).toBe(0);
  });

  it("M: mentions only resolve to issues the author can open in the page's org", async () => {
    const foreignProject = await prisma.project.findUniqueOrThrow({ where: { id: b.projectId } });
    const ownProject = await prisma.project.findUniqueOrThrow({ where: { id: a.projectId } });
    await updatePage(spaceId, 'p', member.id, {
      body: `See ${foreignProject.prefix}-1 and ${ownProject.prefix}-1`,
    });
    const links = await prisma.wikiPageIssueLink.findMany({ where: { pageId } });
    expect(links.map((l) => l.issueId)).toEqual([ownIssueId]);
  });

  it("N: link lists leave out issues and pages the viewer can't open", async () => {
    // A link to an issue the org-only member can't open (they aren't on the team)
    const forPage = await getLinksForPage(pageId, orgOnly.id);
    expect(JSON.stringify(forPage)).not.toContain(SECRET);

    // A restricted page linked to the issue stays hidden from a member it hides it from
    const hidden = await prisma.page.create({
      data: { spaceId, title: `${SECRET} hidden page`, slug: 'hidden', body: '' },
    });
    await prisma.pageRestriction.create({
      data: { pageId: hidden.id, type: 'VIEW', userId: a.owner.id },
    });
    await prisma.wikiPageIssueLink.create({
      data: { pageId: hidden.id, issueId: ownIssueId, linkType: 'EMBED', createdById: a.owner.id },
    });
    const forIssue = await getLinksForIssue(ownIssueId, member.id);
    expect(JSON.stringify(forIssue)).not.toContain('hidden page');
    const rest = await authGet(`/api/projects/${a.projectId}/issues/1/wiki-links`, member.token);
    expect(rest.status).toBe(200);
    expect(JSON.stringify(rest.body)).not.toContain('hidden page');
  });

  it("5: an editor who can't see a mentioned issue doesn't remove its link", async () => {
    const ownProject = await prisma.project.findUniqueOrThrow({ where: { id: a.projectId } });
    await prisma.page.create({
      data: { spaceId, title: 'Mentions', slug: 'mentions', body: '' },
    });
    await updatePage(spaceId, 'mentions', member.id, {
      body: `Tracking ${ownProject.prefix}-1 here`,
    });
    const page = await prisma.page.findFirstOrThrow({ where: { spaceId, slug: 'mentions' } });
    expect(await prisma.wikiPageIssueLink.count({ where: { pageId: page.id } })).toBe(1);

    // An org member off the team fixes a typo; the mention text is unchanged
    await updatePage(spaceId, 'mentions', orgOnly.id, {
      body: `Tracking ${ownProject.prefix}-1 here, fixed`,
    });
    expect(await prisma.wikiPageIssueLink.count({ where: { pageId: page.id } })).toBe(1);

    // A viewer of the issue who removes the mention does remove the link
    await updatePage(spaceId, 'mentions', member.id, { body: 'Nothing tracked' });
    expect(await prisma.wikiPageIssueLink.count({ where: { pageId: page.id } })).toBe(0);
  });
});
