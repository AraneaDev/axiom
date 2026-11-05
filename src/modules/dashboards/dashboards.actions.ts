import { z } from 'zod';

import { defineAction, type ActionContext } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { queryRunOutput } from '../search/query.actions';

import * as dashboardsService from './dashboards.service';
import { assertEmbedReadable, EMBED_ID_MAX, renderEmbedded } from './embedded.service';

const record = z.looseObject({ id: z.string() });
const nothing = z.void();

const DASHBOARDS = '/api/dashboards';

const id = z.string().min(1).max(64);
const NAME_MAX = 200;
const DESCRIPTION_MAX = 1000;
const QUERY_MAX = 1000;

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const noTarget = z.object({});
const dashboardTarget = z.object({ id });
const widgetTarget = dashboardTarget.extend({ widgetId: id });
const embedTarget = z.object({ pageId: id });

const widgetType = z
  .enum(['TABLE', 'COUNT', 'BAR', 'LIST', 'SPRINT_OVERVIEW'])
  .describe(
    'COUNT counts the matches. TABLE and LIST show items or groups. BAR needs a query with ' +
      'GROUP BY. SPRINT_OVERVIEW shows sprint progress and takes no query.',
  );

const sharingFields = {
  visibility: z
    .enum(['PRIVATE', 'TEAM', 'ORG'])
    .optional()
    .describe('Who can open it. PRIVATE: you; TEAM: the team in teamId; ORG: the org in orgId'),
  teamId: id.optional(),
  orgId: id.optional(),
};

const renderedResult = z.union([
  queryRunOutput,
  z.looseObject({ sprints: z.array(z.looseObject({})) }),
  z.looseObject({ error: z.looseObject({ message: z.string(), code: z.string() }) }),
]);

/**
 * Throw unless the caller may change the dashboard.
 * @param ctx - Who runs the action
 * @param target - The dashboard's id
 * @param target.id
 */
async function authorizeEdit(ctx: ActionContext, target: { id: string }): Promise<void> {
  await dashboardsService.loadFor(ctx.userId, target.id, 'edit');
}

/**
 * Throw unless the caller may open the dashboard.
 * @param ctx - Who runs the action
 * @param target - The dashboard's id
 * @param target.id
 */
async function authorizeView(ctx: ActionContext, target: { id: string }): Promise<void> {
  await dashboardsService.loadFor(ctx.userId, target.id, 'view');
}

const dashboardActions = [
  defineAction({
    name: 'dashboard.list',
    area: 'dashboards',
    kind: 'read',
    summary: 'List the dashboards you made and those shared with your teams and orgs',
    target: noTarget,
    input: noTarget,
    output: z.array(record),
    rest: { method: 'GET', path: DASHBOARDS },
    // The list is cut to what the caller may open in the service
    authorize: async () => {},
    handler: async (ctx) => dashboardsService.list(ctx.userId),
  }),
  defineAction({
    name: 'dashboard.get',
    area: 'dashboards',
    kind: 'read',
    summary: 'Read one dashboard you may open with its widgets as stored, without their data',
    target: dashboardTarget,
    input: dashboardTarget,
    output: record,
    rest: { method: 'GET', path: `${DASHBOARDS}/:id` },
    authorize: authorizeView,
    handler: async (ctx, input) => dashboardsService.get(ctx.userId, input.id),
  }),
  defineAction({
    name: 'dashboard.create',
    area: 'dashboards',
    kind: 'write',
    summary:
      'Create a dashboard. It is private unless visibility is TEAM (with teamId) or ORG (with ' +
      'orgId) and you belong to it. Whoever opens a shared dashboard sees it with their own rights.',
    target: noTarget,
    input: noTarget.extend({
      name: z.string().min(1).max(NAME_MAX),
      description: z.string().max(DESCRIPTION_MAX).optional(),
      layout: dashboardsService.dashboardLayout.optional(),
      ...sharingFields,
    }),
    output: record,
    rest: { method: 'POST', path: DASHBOARDS, status: 201 },
    // Anyone may make one for themselves; sharing is checked against membership in the service
    authorize: async () => {},
    handler: async (ctx, input) =>
      dashboardsService.create(ctx.userId, {
        name: input.name,
        description: input.description,
        layout: input.layout,
        sharing: {
          visibility: input.visibility ?? 'PRIVATE',
          teamId: input.teamId,
          orgId: input.orgId,
        },
      }),
  }),
  defineAction({
    name: 'dashboard.update',
    area: 'dashboards',
    kind: 'write',
    summary:
      'Change a dashboard: name, description, layout and who it is shared with. The creator may, ' +
      'and for TEAM that team admins, for ORG the org owners and admins.',
    target: dashboardTarget,
    input: dashboardTarget.extend({
      name: z.string().min(1).max(NAME_MAX).optional(),
      description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
      layout: dashboardsService.dashboardLayout.optional(),
      ...sharingFields,
    }),
    output: record,
    rest: { method: 'PATCH', path: `${DASHBOARDS}/:id` },
    authorize: authorizeEdit,
    handler: async (ctx, input) =>
      dashboardsService.update(ctx.userId, input.id, {
        name: input.name,
        description: input.description,
        layout: input.layout,
        sharing: { visibility: input.visibility, teamId: input.teamId, orgId: input.orgId },
      }),
  }),
  defineAction({
    name: 'dashboard.delete',
    destructive: true,
    area: 'dashboards',
    kind: 'write',
    summary: 'Delete a dashboard you may change, with its widgets',
    target: dashboardTarget,
    input: dashboardTarget,
    output: nothing,
    rest: { method: 'DELETE', path: `${DASHBOARDS}/:id` },
    preview: (_ctx, { id }) => previews.dashboardDelete(id),
    authorize: authorizeEdit,
    handler: async (ctx, input) => {
      await dashboardsService.remove(ctx.userId, input.id);
    },
  }),
  defineAction({
    name: 'dashboard.render',
    area: 'dashboards',
    kind: 'read',
    summary:
      'Render a dashboard you may open, each widget with your own rights: a shared dashboard ' +
      'shows you what you can see. A widget on a saved query you cannot open runs too, without ' +
      'showing you its text. A widget that fails, or needs a scope your token lacks, has ' +
      '{ error } as its result and the others still render. Query widgets need issues:read, ' +
      'sprint overviews sprints:read. projectIds are the visible projects it reads.',
    target: dashboardTarget,
    input: dashboardTarget,
    output: z.looseObject({
      dashboard: record,
      widgets: z.array(
        z.looseObject({
          id: z.string(),
          type: z.string(),
          title: z.string(),
          result: renderedResult,
        }),
      ),
      projectIds: z.array(z.string()),
    }),
    rest: { method: 'GET', path: `${DASHBOARDS}/:id/render` },
    // The render loads the dashboard for this viewer first thing, and answers 404 as authorize
    // would: its input is the id alone, so nothing runs ahead of that check
    authorize: async () => {},
    handler: async (ctx, input) => dashboardsService.render(ctx, input.id),
  }),
  defineAction({
    name: 'dashboard.renderEmbedded',
    area: 'dashboards',
    kind: 'read',
    summary:
      'Render a live block of a wiki page you can read: whoever may read the page sees it, each ' +
      'widget with their own rights, also when they may not open the dashboard or saved query ' +
      'itself. embedId is the text of a :::query <embedId>::: block in the current body: a saved ' +
      'query id, dashboard:<id> or inline:"<query>". It gives widget titles and results, never ' +
      'query text or sharing. Needs wiki:read as well, and each widget the scope of its data.',
    target: embedTarget,
    input: embedTarget.extend({ embedId: z.string().min(1).max(EMBED_ID_MAX) }),
    output: z.looseObject({
      widgets: z.array(
        z.looseObject({
          id: z.string(),
          type: z.string(),
          title: z.string(),
          result: renderedResult,
        }),
      ),
      projectIds: z.array(z.string()),
    }),
    rest: { method: 'POST', path: `${DASHBOARDS}/embedded`, status: 200 },
    authorize: (ctx, { pageId }) => assertEmbedReadable(ctx, pageId),
    handler: async (ctx, input) => renderEmbedded(ctx, input.pageId, input.embedId),
  }),
  defineAction({
    name: 'dashboardWidget.add',
    area: 'dashboards',
    kind: 'write',
    summary:
      'Add a widget at the end of a dashboard you may change, at most 24. Give savedQueryId or ' +
      'query (as query.run takes it), neither for a SPRINT_OVERVIEW. A saved query needs to be ' +
      'one you may open; once on the dashboard it runs for everyone who may open the dashboard, ' +
      'with their own rights, without showing them its text.',
    target: dashboardTarget,
    input: dashboardTarget.extend({
      type: widgetType,
      title: z.string().min(1).max(NAME_MAX),
      savedQueryId: id.optional(),
      query: z.string().min(1).max(QUERY_MAX).optional(),
      options: dashboardsService.widgetOptions.optional(),
    }),
    output: record,
    rest: { method: 'POST', path: `${DASHBOARDS}/:id/widgets`, status: 201 },
    authorize: authorizeEdit,
    handler: async (ctx, { id: dashboardId, ...data }) =>
      dashboardsService.addWidget(ctx.userId, dashboardId, data),
  }),
  defineAction({
    name: 'dashboardWidget.update',
    area: 'dashboards',
    kind: 'write',
    summary:
      'Change a widget. To change its source, give the new one and null for the other: it keeps ' +
      'one of savedQueryId and query, or neither for a SPRINT_OVERVIEW.',
    target: widgetTarget,
    input: widgetTarget.extend({
      type: widgetType.optional(),
      title: z.string().min(1).max(NAME_MAX).optional(),
      savedQueryId: id.nullable().optional(),
      query: z.string().min(1).max(QUERY_MAX).nullable().optional(),
      options: dashboardsService.widgetOptions.optional(),
    }),
    output: record,
    rest: { method: 'PATCH', path: `${DASHBOARDS}/:id/widgets/:widgetId` },
    authorize: authorizeEdit,
    handler: async (ctx, { id: dashboardId, widgetId, ...data }) =>
      dashboardsService.updateWidget(ctx.userId, dashboardId, widgetId, data),
  }),
  defineAction({
    name: 'dashboardWidget.remove',
    destructive: true,
    area: 'dashboards',
    kind: 'write',
    summary: 'Remove a widget from a dashboard you may change',
    target: widgetTarget,
    input: widgetTarget,
    output: nothing,
    rest: { method: 'DELETE', path: `${DASHBOARDS}/:id/widgets/:widgetId` },
    preview: (_ctx, { id, widgetId }) => previews.dashboardWidgetRemove(id, widgetId),
    authorize: authorizeEdit,
    handler: async (ctx, input) => {
      await dashboardsService.removeWidget(ctx.userId, input.id, input.widgetId);
    },
  }),
  defineAction({
    name: 'dashboardWidget.reorder',
    area: 'dashboards',
    kind: 'write',
    summary: "Put a dashboard's widgets in this order, naming each of them once",
    target: dashboardTarget,
    input: dashboardTarget.extend({ widgetIds: z.array(id).min(1).max(24) }),
    output: nothing,
    rest: { method: 'PUT', path: `${DASHBOARDS}/:id/widgets/order`, status: 204 },
    authorize: authorizeEdit,
    handler: async (ctx, input) => {
      await dashboardsService.reorderWidgets(ctx.userId, input.id, input.widgetIds);
    },
  }),
];

registerActions(dashboardActions);
