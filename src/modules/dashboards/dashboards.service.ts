/**
 * Dashboards and their widgets. Sharing and edit rights are those of saved queries (lib/sharing).
 * A widget runs with the rights of whoever renders it, whoever made the dashboard, and a widget
 * that fails answers with its error and leaves the others alone. A widget on a saved query runs
 * for anyone who may open the dashboard, as a block in a wiki page does for its readers, and what
 * the saved query says stays with those who may open it.
 */
import { Prisma, type Dashboard, type DashboardWidget, type WidgetType } from '@prisma/client';
import { z } from 'zod';

import type { ActionContext } from '../../actions/define';
import { READS_BUSY, readSlots } from '../../actions/read.service';
import { prisma } from '../../config/database';
import {
  assertAccess,
  canEdit,
  editRightsOf,
  resolveSharing,
  resolveSharingChange,
  sharedWith,
  type SharingInput,
} from '../../lib/sharing';
import { AppError } from '../../middleware/errorHandler';
import { perUserLimit } from '../../middleware/rate-limit';
import { scopeAllows } from '../../middleware/token-scopes';
import { MAX_ROOMS_PER_SOCKET } from '../../realtime/room-access';
import { logger } from '../../utils/logger';
import {
  assertParses,
  embeddedTextToRun,
  loadFor as loadSavedQuery,
  mayOpen,
} from '../saved-filters/saved-filters.service';
import { runQueryInHeldSlot, type QueryInput } from '../search/query.service';
import { projectsInScope, viewableProjectsWhere } from '../search/search-access';
import { sprintOverview } from '../sprints/sprint-progress.service';

const WHAT = 'Dashboard';
const LIST_LIMIT = 100;
const MAX_WIDGETS = 24;
const DEFAULT_WIDGET_LIMIT = 25;

/** The most widgets of one render running at once */
export const WIDGETS_AT_ONCE = 4;

/**
 * Renders per user. Apart from the search budget: a live view refetches every 2 seconds at most
 * while its projects are busy, and that must not cut its viewer off from search. Room for two
 * such views.
 */
export const RENDER_LIMIT = { windowMs: 60_000, max: 60 } as const;
export const limitRender = perUserLimit(
  RENDER_LIMIT,
  'Too many dashboard renders, please try again later',
);

const scopeId = z.string().min(1).max(64).optional();

/** What a widget can narrow its query to, and how much it shows */
export const widgetOptions = z.object({
  limit: z.number().int().min(1).max(100).optional().describe('The most items or groups to show'),
  state: z.enum(['ACTIVE', 'PLANNING']).optional().describe('Sprint overview: which sprints'),
  scope: z.object({ orgId: scopeId, teamId: scopeId, projectId: scopeId }).optional(),
});
export type WidgetOptions = z.infer<typeof widgetOptions>;

/** How the view lays out its widgets */
export const dashboardLayout = z.object({ columns: z.number().int().min(1).max(4) });
export type DashboardLayout = z.infer<typeof dashboardLayout>;

const WIDGET_SELECT = {
  id: true,
  type: true,
  title: true,
  savedQueryId: true,
  query: true,
  options: true,
  position: true,
} as const;

const WIDGET_ORDER = [
  { position: 'asc' },
  { id: 'asc' },
] satisfies Prisma.DashboardWidgetOrderByWithRelationInput[];

/**
 * Load a dashboard the user may open (404 otherwise) or, with 'edit', change (403 when they can
 * open it and not change it).
 * @param userId - The user
 * @param id - The dashboard
 * @param need - 'view' or 'edit'
 */
export async function loadFor(
  userId: string,
  id: string,
  need: 'view' | 'edit',
): Promise<Dashboard> {
  const row = await prisma.dashboard.findUnique({ where: { id } });
  return assertAccess(userId, row, row?.ownerId, need, WHAT);
}

async function withEdit(userId: string, row: Dashboard) {
  return { ...row, canEdit: await canEdit(userId, row, row.ownerId) };
}

/**
 * Create a dashboard, private unless shared with a team or org the user belongs to.
 * @param userId - The creator
 * @param data - Name, description, layout and sharing
 * @param data.name
 * @param data.description
 * @param data.layout
 * @param data.sharing
 */
export async function create(
  userId: string,
  data: {
    name: string;
    description?: string;
    layout?: DashboardLayout;
    sharing: SharingInput;
  },
) {
  const sharing = await resolveSharing(userId, data.sharing);
  const row = await prisma.dashboard.create({
    data: {
      ownerId: userId,
      name: data.name,
      description: data.description ?? null,
      layout: data.layout ?? {},
      ...sharing,
    },
  });
  return withEdit(userId, row);
}

/**
 * The user's own dashboards and those shared with their teams and orgs.
 * @param userId - The user
 */
export async function list(userId: string) {
  const include = { _count: { select: { widgets: true } } } as const;
  // The user's own come first, so shared ones can never push them out of the page
  const own = await prisma.dashboard.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: 'desc' },
    take: LIST_LIMIT,
    include,
  });
  const shared =
    own.length < LIST_LIMIT
      ? await prisma.dashboard.findMany({
          where: { AND: [sharedWith(userId, 'ownerId'), { ownerId: { not: userId } }] },
          orderBy: { updatedAt: 'desc' },
          take: LIST_LIMIT - own.length,
          include,
        })
      : [];
  const mayEdit = await editRightsOf(userId);
  return [...own, ...shared].map(({ _count, ...row }) => ({
    ...row,
    widgetCount: _count.widgets,
    canEdit: mayEdit(row, row.ownerId),
  }));
}

/**
 * One dashboard the user may open, with its widgets as they are stored.
 * @param userId - The user
 * @param id - The dashboard
 */
export async function get(userId: string, id: string) {
  const row = await loadFor(userId, id, 'view');
  const widgets = await prisma.dashboardWidget.findMany({
    where: { dashboardId: id },
    orderBy: WIDGET_ORDER,
    select: WIDGET_SELECT,
  });
  return { ...(await withEdit(userId, row)), widgets };
}

/**
 * Change a dashboard. Moving it to a team or org needs membership of that one.
 * @param userId - The user changing it
 * @param id - The dashboard
 * @param data - What to change
 * @param data.name
 * @param data.description
 * @param data.layout
 * @param data.sharing
 * @param data.sharing.visibility
 * @param data.sharing.teamId
 * @param data.sharing.orgId
 */
export async function update(
  userId: string,
  id: string,
  data: {
    name?: string;
    description?: string | null;
    layout?: DashboardLayout;
    sharing: { visibility?: SharingInput['visibility']; teamId?: string; orgId?: string };
  },
) {
  const current = await loadFor(userId, id, 'edit');
  const sharing = await resolveSharingChange(userId, current, data.sharing);
  const row = await prisma.dashboard.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.layout !== undefined ? { layout: data.layout } : {}),
      ...sharing,
    },
  });
  return withEdit(userId, row);
}

/**
 * Delete a dashboard and its widgets.
 * @param userId - The user deleting it
 * @param id - The dashboard
 */
export async function remove(userId: string, id: string): Promise<void> {
  await loadFor(userId, id, 'edit');
  await prisma.dashboard.delete({ where: { id } });
}

/** Where a widget gets its data */
interface WidgetSource {
  type: WidgetType;
  savedQueryId: string | null;
  query: string | null;
}

/**
 * Check a widget has the source its type calls for: a sprint overview none, the others exactly one
 * of a saved and an inline query.
 * @param source - The widget as it would be stored
 * @param source.type
 * @param source.savedQueryId
 * @param source.query
 * @throws {AppError} 400
 */
function assertSource({ type, savedQueryId, query }: WidgetSource): void {
  if (type === 'SPRINT_OVERVIEW') {
    if (savedQueryId !== null || query !== null) {
      throw new AppError(400, 'A sprint overview takes no query');
    }
  } else if ((savedQueryId === null) === (query === null)) {
    throw new AppError(400, 'Give either savedQueryId or query');
  }
}

/**
 * Run work that depends on a dashboard's widgets, with the dashboard locked: the cap and the
 * positions hold when several writes arrive at once.
 * @param dashboardId - The dashboard
 * @param work - The work
 */
function withLockedDashboard<T>(
  dashboardId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM dashboards WHERE id = ${dashboardId} FOR UPDATE`;
    return work(tx);
  });
}

/**
 * Add a widget at the end of a dashboard the user may change.
 * @param userId - The user
 * @param dashboardId - The dashboard
 * @param data - The widget
 * @param data.type
 * @param data.title
 * @param data.savedQueryId
 * @param data.query
 * @param data.options
 * @throws {AppError} 400 for a bad source or past the widget cap; 404 for a saved query they
 * cannot open
 */
export async function addWidget(
  userId: string,
  dashboardId: string,
  data: {
    type: WidgetType;
    title: string;
    savedQueryId?: string;
    query?: string;
    options?: WidgetOptions;
  },
) {
  await loadFor(userId, dashboardId, 'edit');
  const source = {
    type: data.type,
    savedQueryId: data.savedQueryId ?? null,
    query: data.query ?? null,
  };
  assertSource(source);
  if (source.query !== null) assertParses(source.query);
  if (source.savedQueryId !== null) await loadSavedQuery(userId, source.savedQueryId, 'view');
  return withLockedDashboard(dashboardId, async (tx) => {
    const last = await tx.dashboardWidget.aggregate({
      where: { dashboardId },
      _count: { _all: true },
      _max: { position: true },
    });
    if (last._count._all >= MAX_WIDGETS) {
      throw new AppError(400, `A dashboard holds at most ${MAX_WIDGETS} widgets`);
    }
    return tx.dashboardWidget.create({
      data: {
        ...source,
        dashboardId,
        title: data.title,
        options: data.options ?? {},
        position: (last._max.position ?? -1) + 1,
      },
      select: WIDGET_SELECT,
    });
  });
}

async function loadWidget(dashboardId: string, widgetId: string): Promise<DashboardWidget> {
  const widget = await prisma.dashboardWidget.findFirst({ where: { id: widgetId, dashboardId } });
  if (!widget) throw new AppError(404, 'Widget not found');
  return widget;
}

/**
 * Change a widget of a dashboard the user may change.
 * @param userId - The user
 * @param dashboardId - The dashboard
 * @param widgetId - The widget
 * @param data - What to change; null clears a source
 * @param data.type
 * @param data.title
 * @param data.savedQueryId
 * @param data.query
 * @param data.options
 * @throws {AppError} 400 for a bad source; 404 for a widget of another dashboard or a saved query
 * they cannot open
 */
export async function updateWidget(
  userId: string,
  dashboardId: string,
  widgetId: string,
  data: {
    type?: WidgetType;
    title?: string;
    savedQueryId?: string | null;
    query?: string | null;
    options?: WidgetOptions;
  },
) {
  await loadFor(userId, dashboardId, 'edit');
  const widget = await loadWidget(dashboardId, widgetId);
  const source = {
    type: data.type ?? widget.type,
    savedQueryId: data.savedQueryId === undefined ? widget.savedQueryId : data.savedQueryId,
    query: data.query === undefined ? widget.query : data.query,
  };
  assertSource(source);
  if (source.query !== null && source.query !== widget.query) assertParses(source.query);
  // A saved query it already has stays, also for an editor who cannot open it
  if (source.savedQueryId !== null && source.savedQueryId !== widget.savedQueryId) {
    await loadSavedQuery(userId, source.savedQueryId, 'view');
  }
  return prisma.dashboardWidget.update({
    where: { id: widgetId },
    data: {
      ...source,
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.options !== undefined ? { options: data.options } : {}),
    },
    select: WIDGET_SELECT,
  });
}

/**
 * Remove a widget of a dashboard the user may change.
 * @param userId - The user
 * @param dashboardId - The dashboard
 * @param widgetId - The widget
 * @throws {AppError} 404 for a widget of another dashboard
 */
export async function removeWidget(
  userId: string,
  dashboardId: string,
  widgetId: string,
): Promise<void> {
  await loadFor(userId, dashboardId, 'edit');
  const { count } = await prisma.dashboardWidget.deleteMany({
    where: { id: widgetId, dashboardId },
  });
  if (count === 0) throw new AppError(404, 'Widget not found');
}

/**
 * Put a dashboard's widgets in the order given.
 * @param userId - The user
 * @param dashboardId - The dashboard
 * @param widgetIds - Every widget of the dashboard, once
 * @throws {AppError} 400 unless the list is exactly the dashboard's widgets
 */
export async function reorderWidgets(
  userId: string,
  dashboardId: string,
  widgetIds: string[],
): Promise<void> {
  await loadFor(userId, dashboardId, 'edit');
  await withLockedDashboard(dashboardId, async (tx) => {
    const widgets = await tx.dashboardWidget.findMany({
      where: { dashboardId },
      select: { id: true },
    });
    const named = new Set(widgetIds);
    if (
      named.size !== widgetIds.length ||
      widgetIds.length !== widgets.length ||
      !widgets.every((widget) => named.has(widget.id))
    ) {
      throw new AppError(400, "widgetIds must name each of the dashboard's widgets once");
    }
    for (const [position, id] of widgetIds.entries()) {
      await tx.dashboardWidget.update({ where: { id }, data: { position } });
    }
  });
}

/**
 * Map over items with a cap on how many run at once; the results keep the items' order.
 * @param items - The items
 * @param cap - The most at once
 * @param work - What to do with one; it should not throw, or the others keep running unobserved
 */
export async function mapWithCap<T, R>(
  items: readonly T[],
  cap: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, worker));
  return results;
}

/**
 * What a failed widget answers. An unexpected error is logged and says nothing about itself.
 * @param widgetId - The widget
 * @param err - What was thrown
 */
export function widgetError(widgetId: string, err: unknown) {
  if (err instanceof AppError && err.statusCode < 500) {
    return {
      error: { status: err.statusCode, code: err.code ?? 'ERROR', message: err.message },
    };
  }
  logger.error('A dashboard widget failed', { widgetId }, err as Error);
  return { error: { status: 500, code: 'INTERNAL', message: 'This widget could not be rendered' } };
}

/**
 * What a failed widget of something the viewer may not open answers: the query language's messages
 * quote the query, and a saved query's name is not theirs to know either. A missing scope is about
 * their token, so that one says so.
 * @param widgetId - The widget
 * @param err - What was thrown
 */
export const hiddenWidgetError: typeof widgetError = (widgetId, err) => {
  const answer = widgetError(widgetId, err);
  return answer.error.code === 'SCOPE'
    ? answer
    : { error: { ...answer.error, message: 'This widget could not be rendered' } };
};

export type WidgetRow = Pick<DashboardWidget, keyof typeof WIDGET_SELECT>;

type WidgetFailure = ReturnType<typeof widgetError>;

/** How one render reads what its widgets refer to and says what went wrong with them */
export interface RenderRules {
  /** The text of a saved query */
  savedText: (savedQueryId: string) => Promise<{ text: string; projectId?: string }>;
  /** What a failed widget answers. It may not throw */
  errorOf: (widget: WidgetRow, err: unknown) => WidgetFailure | Promise<WidgetFailure>;
}

/**
 * Get a widget's data with the viewer's rights.
 * @param ctx - The viewer
 * @param widget - The widget
 * @param options - Its options
 * @param savedText - Reads its saved query
 * @returns The result, and the scope of the projects it read
 */
async function widgetData(
  ctx: ActionContext,
  widget: WidgetRow,
  options: WidgetOptions,
  savedText: RenderRules['savedText'],
) {
  if (widget.type === 'SPRINT_OVERVIEW') {
    // sprints:read alone, as the sprint report (P9)
    if (ctx.scopes && !scopeAllows(ctx.scopes, 'sprints', 'read')) {
      throw new AppError(403, 'This API token does not have the scope for this widget', 'SCOPE');
    }
    const { sprints } = await sprintOverview(ctx.userId, {
      state: options.state ?? 'ACTIVE',
      scope: options.scope,
      includeBlocked: true,
    });
    // The spread turns each entry's interface into a plain object for the loose output schema
    return {
      result: { sprints: sprints.map((sprint) => ({ ...sprint })) },
      scope: options.scope,
    };
  }
  // A saved query, loaded on every render: it may have changed or gone since the last one
  const saved = widget.savedQueryId ? await savedText(widget.savedQueryId) : null;
  const text = saved?.text ?? widget.query;
  if (text === null) throw new AppError(404, 'The saved query of this widget no longer exists');
  const scope: QueryInput['scope'] = saved?.projectId
    ? { ...options.scope, projectId: saved.projectId }
    : options.scope;
  const result = await runQueryInHeldSlot(
    ctx,
    { query: text, limit: options.limit ?? DEFAULT_WIDGET_LIMIT, scope },
    { count: widget.type === 'COUNT' },
  );
  if (widget.type === 'BAR' && result.kind !== 'groups') {
    throw new AppError(400, 'A bar chart needs a query with GROUP BY', 'INVALID_QUERY');
  }
  return { result, scope };
}

/**
 * A dashboard's widgets, in their order.
 * @param dashboardId - The dashboard
 */
export function widgetsOf(dashboardId: string): Promise<WidgetRow[]> {
  return prisma.dashboardWidget.findMany({
    where: { dashboardId },
    orderBy: WIDGET_ORDER,
    select: WIDGET_SELECT,
  });
}

/**
 * Run widgets with the viewer's rights, at most WIDGETS_AT_ONCE at a time. The caller holds the
 * read slot and has counted against a limit.
 * @param ctx - The viewer
 * @param rows - The widgets
 * @param rules - How this render reads saved queries and reports errors
 * @returns Their results, and the projects a live view should follow: those the widgets read that
 * the viewer can see, up to what one socket may join
 */
export async function renderWidgets(ctx: ActionContext, rows: WidgetRow[], rules: RenderRules) {
  const rendered = await mapWithCap(rows, WIDGETS_AT_ONCE, async (widget) => {
    try {
      const options = widgetOptions.parse(widget.options);
      const { result, scope } = await widgetData(ctx, widget, options, rules.savedText);
      return { result, scope, ok: true as const };
    } catch (err) {
      return { result: await rules.errorOf(widget, err), scope: undefined, ok: false as const };
    }
  });
  const followed = rendered.filter((widget) => widget.ok);
  const projects = followed.length
    ? await prisma.project.findMany({
        where: {
          AND: [
            await viewableProjectsWhere(ctx.userId),
            { OR: followed.map((widget) => projectsInScope(widget.scope)) },
          ],
        },
        orderBy: { id: 'asc' },
        take: MAX_ROOMS_PER_SOCKET,
        select: { id: true },
      })
    : [];
  return {
    widgets: rows.map((widget, index) => ({
      id: widget.id,
      type: widget.type,
      title: widget.title,
      result: rendered[index].result,
    })),
    projectIds: projects.map((project) => project.id),
  };
}

/**
 * Render a dashboard with the viewer's rights: each widget runs as they would run it, also on a
 * saved query they cannot open themselves, and one that fails answers with its error, which keeps
 * quiet about a saved query they cannot open. The render as a whole takes one read slot and counts once against
 * RENDER_LIMIT, the widgets none of either, and at most WIDGETS_AT_ONCE run at once.
 * @param ctx - The viewer
 * @param id - The dashboard, which they may open
 * @returns The dashboard, its widgets' results and the projects a live view should follow: those
 * the widgets read that the viewer can see, up to what one socket may join
 * @throws {AppError} 429 past the limit or the read cap
 */
export async function render(ctx: ActionContext, id: string) {
  const dashboard = await loadFor(ctx.userId, id, 'view');
  await limitRender(ctx.userId);
  return readSlots.run(ctx.userId, READS_BUSY, async () => {
    const widgets = await renderWidgets(ctx, await widgetsOf(id), {
      savedText: embeddedTextToRun,
      errorOf: async (widget, err) => {
        // Asked only of a widget that failed. When the answer can't be had, it stays hidden
        const open =
          widget.savedQueryId === null ||
          (await mayOpen(ctx.userId, widget.savedQueryId).catch(() => false));
        return open ? widgetError(widget.id, err) : hiddenWidgetError(widget.id, err);
      },
    });
    return { dashboard: await withEdit(ctx.userId, dashboard), ...widgets };
  });
}
