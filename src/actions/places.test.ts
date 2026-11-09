/**
 * Every place resolver, case by case (decision 11): the teams, spaces and pages an input touches,
 * org level where it touches none, and nothing for an id that names nothing, so that a request
 * about something gone is decided by nobody rather than by anybody.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../config/database';
import { cleanupTestContext, createTestContext, type TestContext } from '../test/factory';

import type { ActionContext } from './define';
import * as places from './places';
import type { PlaceRefs, PlaceResolver } from './places';

const MISSING = 'voorbeeld-missing-id';

/**
 * A find with sorted, de-duplicated ids and empty lists left out, so that cases compare by content.
 * @param found - What a resolver found
 */
function normal(found: PlaceRefs): PlaceRefs {
  const out: PlaceRefs = {};
  for (const key of ['teamIds', 'spaceIds', 'pageIds'] as const) {
    const ids = [...new Set(found[key] ?? [])].sort();
    if (ids.length > 0) out[key] = ids;
  }
  if (found.orgLevel) out.orgLevel = true;
  return out;
}

describe('place resolvers', () => {
  let ctx: TestContext;
  let caller: ActionContext;
  let otherTeamId: string;
  let otherProjectId: string;
  let spaceId: string;
  let otherSpaceId: string;
  let pageId: string;
  let childPageId: string;
  let issueId: string;
  let issueNumber: number;
  let otherIssueId: string;
  let sprintId: string;
  let commentId: string;
  let pageCommentId: string;
  let restrictionId: string;
  let templateId: string;
  let milestoneId: string;
  let fieldId: string;
  let requestId: string;
  let issueAttachmentId: string;
  let pageAttachmentId: string;
  let commentAttachmentId: string;
  let privateDashboardId: string;
  let teamDashboardId: string;
  let privateQueryId: string;
  let teamQueryId: string;
  let projectQueryId: string;

  beforeAll(async () => {
    ctx = await createTestContext(`places${Date.now()}`);
    caller = { userId: ctx.owner.id, channel: 'rest-token', apiTokenId: 'probe', scopes: [] };
    const owner = ctx.owner.id;
    const tag = Date.now() % 1_000_000;

    const otherTeam = await prisma.team.create({
      data: { orgId: ctx.orgId, name: `Voorbeeld ander ${tag}`, slug: `voorbeeld-ander-${tag}` },
    });
    otherTeamId = otherTeam.id;
    const otherProject = await prisma.project.create({
      data: {
        teamId: otherTeamId,
        name: 'Voorbeeld ander project',
        slug: `voorbeeld-ander-project-${tag}`,
        prefix: `VB${tag}`,
      },
    });
    otherProjectId = otherProject.id;

    spaceId = (
      await prisma.wikiSpace.create({
        data: { teamId: ctx.teamId, name: 'Voorbeeld wiki', slug: `voorbeeld-wiki-${tag}` },
      })
    ).id;
    otherSpaceId = (
      await prisma.wikiSpace.create({
        data: { teamId: otherTeamId, name: 'Voorbeeld ander', slug: `voorbeeld-ander-${tag}` },
      })
    ).id;
    pageId = (
      await prisma.page.create({
        data: { spaceId, title: 'Voorbeeld page', slug: 'voorbeeld-page', body: 'Hallo' },
      })
    ).id;
    childPageId = (
      await prisma.page.create({
        data: { spaceId, parentId: pageId, title: 'Kind', slug: 'kind', body: 'Hallo' },
      })
    ).id;

    issueNumber = 4100;
    const issue = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: issueNumber,
        title: 'Voorbeeld issue',
        body: '',
        creatorId: owner,
      },
    });
    issueId = issue.id;
    otherIssueId = (
      await prisma.issue.create({
        data: {
          projectId: otherProjectId,
          number: 1,
          title: 'Ander issue',
          body: '',
          creatorId: owner,
        },
      })
    ).id;
    sprintId = (
      await prisma.sprint.create({
        data: {
          projectId: ctx.projectId,
          name: 'Voorbeeld sprint',
          startDate: new Date(),
          endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      })
    ).id;
    commentId = (await prisma.comment.create({ data: { issueId, authorId: owner, body: 'Hoi' } }))
      .id;
    pageCommentId = (
      await prisma.pageComment.create({ data: { pageId, userId: owner, body: 'Hoi' } })
    ).id;
    restrictionId = (
      await prisma.pageRestriction.create({ data: { pageId, type: 'EDIT', userId: owner } })
    ).id;
    templateId = (
      await prisma.pageTemplate.create({ data: { spaceId, name: 'Voorbeeld sjabloon', body: '#' } })
    ).id;
    milestoneId = (
      await prisma.milestone.create({ data: { projectId: ctx.projectId, title: 'Voorbeeld mijl' } })
    ).id;
    fieldId = (
      await prisma.customFieldDefinition.create({
        data: { projectId: ctx.projectId, name: 'Voorbeeld veld', type: 'TEXT' },
      })
    ).id;
    const columns = await prisma.boardColumn.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { position: 'asc' },
    });
    const gate = await prisma.approvalGate.create({
      data: { projectId: ctx.projectId, fromColumnId: columns[0].id, toColumnId: columns[1].id },
    });
    requestId = (
      await prisma.approvalRequest.create({
        data: {
          issueId,
          approvalGateId: gate.id,
          targetColumnId: columns[1].id,
          requestedById: owner,
          approverIds: [],
        },
      })
    ).id;
    const file = {
      filename: 'notes.txt',
      originalName: 'notes.txt',
      mimeType: 'text/plain',
      size: 4,
      uploaderId: owner,
    };
    issueAttachmentId = (
      await prisma.attachment.create({ data: { ...file, storageKey: `pl-i-${tag}`, issueId } })
    ).id;
    pageAttachmentId = (
      await prisma.attachment.create({ data: { ...file, storageKey: `pl-p-${tag}`, pageId } })
    ).id;
    commentAttachmentId = (
      await prisma.attachment.create({ data: { ...file, storageKey: `pl-c-${tag}`, commentId } })
    ).id;
    privateDashboardId = (
      await prisma.dashboard.create({ data: { name: 'Eigen', ownerId: owner } })
    ).id;
    teamDashboardId = (
      await prisma.dashboard.create({
        data: { name: 'Team', ownerId: owner, visibility: 'TEAM', teamId: ctx.teamId },
      })
    ).id;
    privateQueryId = (
      await prisma.savedFilter.create({
        data: { userId: owner, name: 'Eigen', query: 'type = Bug' },
      })
    ).id;
    teamQueryId = (
      await prisma.savedFilter.create({
        data: {
          userId: owner,
          name: 'Ander team',
          query: 'type = Bug',
          visibility: 'TEAM',
          teamId: otherTeamId,
        },
      })
    ).id;
    projectQueryId = (
      await prisma.savedFilter.create({
        data: { userId: owner, name: 'Project', query: 'type = Bug', projectId: ctx.projectId },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  type Case = [label: string, resolver: PlaceResolver, input: () => unknown, want: () => PlaceRefs];

  const cases: Case[] = [
    ['orgLevelPlace', places.orgLevelPlace, () => ({}), () => ({ orgLevel: true })],
    ['inputPlace, nothing named', places.inputPlace, () => ({}), () => ({})],
    // One field per case: a resolver that stops reading any one of them fails its case
    ...(
      [
        ['teamId', () => otherTeamId, () => ({ teamIds: [otherTeamId] })],
        ['projectId', () => ctx.projectId, () => ({ teamIds: [ctx.teamId] })],
        ['targetProjectId', () => otherProjectId, () => ({ teamIds: [otherTeamId] })],
        ['issueId', () => issueId, () => ({ teamIds: [ctx.teamId] })],
        ['issueIds', () => [otherIssueId], () => ({ teamIds: [otherTeamId] })],
        ['sprintId', () => sprintId, () => ({ teamIds: [ctx.teamId] })],
        ['spaceId', () => spaceId, () => ({ spaceIds: [spaceId] })],
        ['targetSpaceId', () => otherSpaceId, () => ({ spaceIds: [otherSpaceId] })],
        ['releaseNotesSpaceId', () => otherSpaceId, () => ({ spaceIds: [otherSpaceId] })],
        ['pageId', () => pageId, () => ({ pageIds: [pageId] })],
        ['parentId', () => childPageId, () => ({ pageIds: [childPageId] })],
        ['targetParentId', () => pageId, () => ({ pageIds: [pageId] })],
      ] as Array<[string, () => unknown, () => PlaceRefs]>
    ).map(
      ([field, value, want]): Case => [
        `inputPlace, ${field} alone`,
        places.inputPlace,
        () => ({ [field]: value() }),
        want,
      ],
    ),
    [
      'inputPlace, a slug that names a page',
      places.inputPlace,
      () => ({ spaceId, pageSlug: 'kind' }),
      () => ({ pageIds: [childPageId] }),
    ],
    [
      'inputPlace, a slug no page has yet: the space',
      places.inputPlace,
      () => ({ spaceId, pageSlug: 'nog-niet' }),
      () => ({ spaceIds: [spaceId] }),
    ],
    [
      'inputPlace, ids that name nothing',
      places.inputPlace,
      () => ({ projectId: MISSING, issueId: MISSING, sprintId: MISSING }),
      () => ({}),
    ],
    [
      'projectPlace, its team only, not the form page',
      places.projectPlace,
      () => ({ projectId: ctx.projectId, pageId: 'voorbeeld-form-page' }),
      () => ({ teamIds: [ctx.teamId] }),
    ],
    [
      'inputOrOrgPlace, nothing named',
      places.inputOrOrgPlace,
      () => ({}),
      () => ({ orgLevel: true }),
    ],
    [
      'inputOrOrgPlace, a team named',
      places.inputOrOrgPlace,
      () => ({ teamId: ctx.teamId }),
      () => ({ teamIds: [ctx.teamId] }),
    ],
    [
      'pageCommentPlace',
      places.pageCommentPlace,
      () => ({ commentId: pageCommentId }),
      () => ({ pageIds: [pageId] }),
    ],
    [
      'pageCommentPlace, unknown',
      places.pageCommentPlace,
      () => ({ commentId: MISSING }),
      () => ({}),
    ],
    [
      'pageRestrictionPlace',
      places.pageRestrictionPlace,
      () => ({ restrictionId }),
      () => ({ pageIds: [pageId] }),
    ],
    [
      'pageRestrictionPlace, unknown',
      places.pageRestrictionPlace,
      () => ({ restrictionId: MISSING }),
      () => ({}),
    ],
    [
      'pageTemplatePlace',
      places.pageTemplatePlace,
      () => ({ templateId }),
      () => ({ spaceIds: [spaceId] }),
    ],
    [
      'pageTemplatePlace, unknown',
      places.pageTemplatePlace,
      () => ({ templateId: MISSING }),
      () => ({}),
    ],
    [
      'templateContextPlace',
      places.templateContextPlace,
      () => ({ context: { spaceId, projectId: otherProjectId } }),
      () => ({ teamIds: [otherTeamId], spaceIds: [spaceId] }),
    ],
    ['templateContextPlace, no context', places.templateContextPlace, () => ({}), () => ({})],
    [
      'milestonePlace',
      places.milestonePlace,
      () => ({ milestoneId }),
      () => ({ teamIds: [ctx.teamId] }),
    ],
    [
      'milestonePlace, unknown',
      places.milestonePlace,
      () => ({ milestoneId: MISSING }),
      () => ({}),
    ],
    [
      'customFieldPlace',
      places.customFieldPlace,
      () => ({ fieldId }),
      () => ({ teamIds: [ctx.teamId] }),
    ],
    [
      'customFieldPlace, unknown',
      places.customFieldPlace,
      () => ({ fieldId: MISSING }),
      () => ({}),
    ],
    [
      'approvalRequestPlace',
      places.approvalRequestPlace,
      () => ({ requestId }),
      () => ({ teamIds: [ctx.teamId] }),
    ],
    [
      'approvalRequestPlace, unknown',
      places.approvalRequestPlace,
      () => ({ requestId: MISSING }),
      () => ({}),
    ],
    [
      'attachmentPlace, on an issue',
      places.attachmentPlace,
      () => ({ id: issueAttachmentId }),
      () => ({ teamIds: [ctx.teamId] }),
    ],
    [
      'attachmentPlace, on a page',
      places.attachmentPlace,
      () => ({ id: pageAttachmentId }),
      () => ({ pageIds: [pageId] }),
    ],
    [
      'attachmentPlace, on a comment: its issue',
      places.attachmentPlace,
      () => ({ id: commentAttachmentId }),
      () => ({ teamIds: [ctx.teamId] }),
    ],
    ['attachmentPlace, unknown', places.attachmentPlace, () => ({ id: MISSING }), () => ({})],
    [
      'uploadFieldsPlace, a comment and a page',
      places.uploadFieldsPlace,
      () => ({ commentId, pageId }),
      () => ({ teamIds: [ctx.teamId], pageIds: [pageId] }),
    ],
    [
      'uploadFieldsPlace, no parent',
      places.uploadFieldsPlace,
      () => ({}),
      () => ({ orgLevel: true }),
    ],
    ['uploadTargetPlace, staged', places.uploadTargetPlace, () => ({}), () => ({ orgLevel: true })],
    [
      'uploadTargetPlace, by ids',
      places.uploadTargetPlace,
      () => ({ target: { projectId: otherProjectId, pageId } }),
      () => ({ teamIds: [otherTeamId], pageIds: [pageId] }),
    ],
    [
      'uploadTargetPlace, by issue key',
      places.uploadTargetPlace,
      () => ({ target: { issueKey: `${ctx.projectPrefix}-${issueNumber}` } }),
      () => ({ teamIds: [ctx.teamId] }),
    ],
    [
      'uploadTargetPlace, by page key',
      places.uploadTargetPlace,
      () => ({ target: { pageKey: `${ctx.orgSlug}/${ctx.teamSlug}/${spaceSlug()}/kind` } }),
      () => ({ pageIds: [childPageId] }),
    ],
    [
      'dashboardPlace, private',
      places.dashboardPlace,
      () => ({ id: privateDashboardId }),
      () => ({ orgLevel: true }),
    ],
    [
      'dashboardPlace, shared with a team',
      places.dashboardPlace,
      () => ({ id: teamDashboardId }),
      () => ({ teamIds: [ctx.teamId] }),
    ],
    [
      'dashboardPlace, reshared with another team',
      places.dashboardPlace,
      () => ({ id: privateDashboardId, visibility: 'TEAM', teamId: otherTeamId }),
      () => ({ teamIds: [otherTeamId] }),
    ],
    ['dashboardPlace, unknown', places.dashboardPlace, () => ({ id: MISSING }), () => ({})],
    [
      'savedQueryPlace, private',
      places.savedQueryPlace,
      () => ({ filterId: privateQueryId }),
      () => ({ orgLevel: true }),
    ],
    [
      'savedQueryPlace, of a project',
      places.savedQueryPlace,
      () => ({ filterId: projectQueryId }),
      () => ({ teamIds: [ctx.teamId] }),
    ],
    [
      'savedQueryPlace, shared with a team',
      places.savedQueryPlace,
      () => ({ filterId: teamQueryId }),
      () => ({ teamIds: [otherTeamId] }),
    ],
    ['savedQueryPlace, unknown', places.savedQueryPlace, () => ({ filterId: MISSING }), () => ({})],
    [
      'dashboardWidgetPlace, no saved query: the dashboard',
      places.dashboardWidgetPlace,
      () => ({ id: teamDashboardId, query: 'type = Bug' }),
      () => ({ teamIds: [ctx.teamId] }),
    ],
    [
      'dashboardWidgetPlace, the dashboard and the saved query',
      places.dashboardWidgetPlace,
      () => ({ id: teamDashboardId, savedQueryId: teamQueryId }),
      () => ({ teamIds: [ctx.teamId, otherTeamId] }),
    ],
    [
      'dashboardWidgetPlace, a private dashboard and a team query',
      places.dashboardWidgetPlace,
      () => ({ id: privateDashboardId, savedQueryId: teamQueryId }),
      () => ({ teamIds: [otherTeamId], orgLevel: true }),
    ],
    [
      'dashboardWidgetPlace, a saved query that names nothing',
      places.dashboardWidgetPlace,
      () => ({ id: privateDashboardId, savedQueryId: MISSING }),
      () => ({}),
    ],
    [
      'dashboardWidgetPlace, a dashboard that names nothing',
      places.dashboardWidgetPlace,
      () => ({ id: MISSING, savedQueryId: privateQueryId }),
      () => ({}),
    ],
  ];

  let slugOfSpace = '';
  /** The slug of the test space, read once. */
  const spaceSlug = () => slugOfSpace;

  it('covers every resolver places.ts exports', () => {
    const exported = Object.entries(places)
      .filter(([name, value]) => typeof value === 'function' && name.endsWith('Place'))
      .map(([name]) => name)
      .filter((name) => name !== 'isEmptyPlace')
      .sort();
    const tested = [...new Set(cases.map(([, resolver]) => resolver))].map(
      (resolver) => Object.entries(places).find(([, value]) => value === resolver)![0],
    );
    expect([...new Set(tested)].sort()).toEqual(exported);
  });

  it.each(cases)('%s', async (_label, resolver, input, want) => {
    if (!slugOfSpace) {
      slugOfSpace = (await prisma.wikiSpace.findUniqueOrThrow({ where: { id: spaceId } })).slug;
    }
    expect(normal(await resolver(caller, input()))).toEqual(want());
  });
});
