import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { prisma } from '../../config/database';
import * as broadcast from '../../realtime/broadcast';

import {
  addEmbedLink,
  removeEmbedLink,
  syncMentionLinks,
  getLinksForPage,
  getLinksForIssue,
} from './wiki-issue-links.service';

describe('Wiki Issue Links Service', () => {
  let userId: string;
  let pageId: string;
  let issueId: string;
  let issueId2: string;
  let issueId3: string;

  beforeAll(async () => {
    // Clean up stale data from previous failed runs
    await prisma.organization
      .delete({ where: { slug: 'wiki-issue-links-test-org' } })
      .catch(() => {});
    await prisma.user.delete({ where: { username: 'wiki-issue-links-test-user' } }).catch(() => {});

    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'wiki-issue-links-test-user' },
      update: {},
      create: {
        email: 'wiki-issue-links-test@axiom.dev',
        username: 'wiki-issue-links-test-user',
        displayName: 'Wiki Issue Links Test User',
        passwordHash,
      },
    });
    userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: 'Wiki Issue Links Test Org',
        slug: 'wiki-issue-links-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Wiki Issue Links Test Team',
        slug: 'wiki-issue-links-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });

    const project = await prisma.project.create({
      data: {
        name: 'Wiki Issue Links Test Project',
        slug: 'wiki-issue-links-test-project',
        prefix: 'WIL',
        teamId: team.id,
      },
    });

    const space = await prisma.wikiSpace.create({
      data: {
        name: 'Wiki Issue Links Test Space',
        slug: 'wiki-issue-links-test-space',
        teamId: team.id,
      },
    });

    const page = await prisma.page.create({
      data: {
        title: 'Wiki Issue Links Test Page',
        slug: 'wiki-issue-links-test-page',
        body: 'Test body content',
        spaceId: space.id,
      },
    });
    pageId = page.id;

    const issue1 = await prisma.issue.create({
      data: {
        title: 'Test Issue 1',
        body: '',
        number: 1,
        projectId: project.id,
        creatorId: user.id,
      },
    });
    issueId = issue1.id;

    const issue2 = await prisma.issue.create({
      data: {
        title: 'Test Issue 2',
        body: '',
        number: 2,
        projectId: project.id,
        creatorId: user.id,
        priority: 'HIGH',
        type: 'BUG',
      },
    });
    issueId2 = issue2.id;

    const issue3 = await prisma.issue.create({
      data: {
        title: 'Test Issue 3',
        body: '',
        number: 3,
        projectId: project.id,
        creatorId: user.id,
        priority: 'LOW',
      },
    });
    issueId3 = issue3.id;
  });

  afterAll(async () => {
    await prisma.wikiPageIssueLink
      .deleteMany({
        where: { pageId },
      })
      .catch(() => {});
    await prisma.organization
      .delete({
        where: { slug: 'wiki-issue-links-test-org' },
      })
      .catch(() => {});
    await prisma.user
      .delete({
        where: { username: 'wiki-issue-links-test-user' },
      })
      .catch(() => {});
  });

  it('linking a wiki page broadcasts issue:links-updated', async () => {
    const spy = vi.spyOn(broadcast, 'broadcastToRoom').mockImplementation(() => {});
    try {
      await addEmbedLink(pageId, issueId, userId);
      expect(spy).toHaveBeenCalledWith(`issue:${issueId}`, {
        type: 'issue:links-updated',
        issueId,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('syncMentionLinks broadcasts issue:links-updated for added and removed issues only', async () => {
    await prisma.wikiPageIssueLink.deleteMany({ where: { pageId } });
    await syncMentionLinks(pageId, [issueId, issueId2], userId);
    const spy = vi.spyOn(broadcast, 'broadcastToRoom').mockImplementation(() => {});
    try {
      // issueId is dropped, issueId2 stays, issueId3 is new.
      await syncMentionLinks(pageId, [issueId2, issueId3], userId);
      const rooms = spy.mock.calls.map(([room]) => room).sort();
      expect(rooms).toEqual([`issue:${issueId}`, `issue:${issueId3}`].sort());
      expect(spy).toHaveBeenCalledWith(`issue:${issueId3}`, {
        type: 'issue:links-updated',
        issueId: issueId3,
      });
    } finally {
      spy.mockRestore();
      await prisma.wikiPageIssueLink.deleteMany({ where: { pageId } });
    }
  });

  it('removeEmbedLink broadcasts issue:links-updated when a link was removed', async () => {
    await addEmbedLink(pageId, issueId, userId);
    const spy = vi.spyOn(broadcast, 'broadcastToRoom').mockImplementation(() => {});
    try {
      await removeEmbedLink(pageId, issueId);
      expect(spy).toHaveBeenCalledWith(`issue:${issueId}`, {
        type: 'issue:links-updated',
        issueId,
      });
      spy.mockClear();
      // Nothing left to remove: no event.
      await removeEmbedLink(pageId, issueId);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('addEmbedLink creates an EMBED link between page and issue', async () => {
    const link = await addEmbedLink(pageId, issueId, userId);
    expect(link).toBeDefined();
    expect(link.pageId).toBe(pageId);
    expect(link.issueId).toBe(issueId);
    expect(link.linkType).toBe('EMBED');
    expect(link.createdById).toBe(userId);
  });

  it('addEmbedLink is idempotent (calling twice does not duplicate)', async () => {
    await addEmbedLink(pageId, issueId, userId);
    await addEmbedLink(pageId, issueId, userId);

    const links = await prisma.wikiPageIssueLink.findMany({
      where: { pageId, issueId, linkType: 'EMBED' },
    });
    expect(links).toHaveLength(1);
  });

  it('removeEmbedLink removes an EMBED link', async () => {
    await addEmbedLink(pageId, issueId, userId);

    const result = await removeEmbedLink(pageId, issueId);
    expect(result.count).toBeGreaterThanOrEqual(1);

    const links = await prisma.wikiPageIssueLink.findMany({
      where: { pageId, issueId, linkType: 'EMBED' },
    });
    expect(links).toHaveLength(0);
  });

  it('syncMentionLinks creates MENTION links for detected issue IDs', async () => {
    await syncMentionLinks(pageId, [issueId, issueId2], userId);

    const links = await prisma.wikiPageIssueLink.findMany({
      where: { pageId, linkType: 'MENTION' },
    });
    expect(links).toHaveLength(2);
    const issueIds = links.map((l) => l.issueId).sort();
    expect(issueIds).toEqual([issueId, issueId2].sort());
  });

  it('syncMentionLinks removes stale MENTION links not in the new set', async () => {
    // First sync with issue1 and issue2
    await syncMentionLinks(pageId, [issueId, issueId2], userId);

    // Second sync with issue2 and issue3 (issue1 should be removed)
    await syncMentionLinks(pageId, [issueId2, issueId3], userId);

    const links = await prisma.wikiPageIssueLink.findMany({
      where: { pageId, linkType: 'MENTION' },
    });
    expect(links).toHaveLength(2);
    const issueIds = links.map((l) => l.issueId).sort();
    expect(issueIds).toEqual([issueId2, issueId3].sort());
  });

  it('getLinksForPage returns links with issue details', async () => {
    // Clean slate
    await prisma.wikiPageIssueLink.deleteMany({ where: { pageId } });
    await addEmbedLink(pageId, issueId, userId);
    await syncMentionLinks(pageId, [issueId2], userId);

    const links = await getLinksForPage(pageId);
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.issue).toBeDefined();
      expect(link.issue.title).toBeDefined();
      expect(link.issue.project).toBeDefined();
      expect(link.issue.project.prefix).toBe('WIL');
    }
  });

  it('getLinksForIssue returns wiki pages linked to an issue', async () => {
    // Clean slate
    await prisma.wikiPageIssueLink.deleteMany({ where: { pageId } });
    await addEmbedLink(pageId, issueId, userId);

    const links = await getLinksForIssue(issueId);
    expect(links).toHaveLength(1);
    expect(links[0].page).toBeDefined();
    expect(links[0].page.title).toBe('Wiki Issue Links Test Page');
    expect(links[0].page.space).toBeDefined();
    expect(links[0].page.space.slug).toBe('wiki-issue-links-test-space');
  });
});
