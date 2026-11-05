import { del, get, patch, post, put } from './client';

export type WidgetType = 'TABLE' | 'COUNT' | 'BAR' | 'LIST' | 'SPRINT_OVERVIEW';
export type DashboardVisibility = 'PRIVATE' | 'TEAM' | 'ORG';

export interface DashboardLayout {
  columns?: number;
}

export interface Dashboard {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  visibility: DashboardVisibility;
  teamId: string | null;
  orgId: string | null;
  layout: DashboardLayout;
  /** Whether the current user may change or delete it */
  canEdit: boolean;
}

export interface DashboardListEntry extends Dashboard {
  widgetCount: number;
}

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  title: string;
  savedQueryId: string | null;
  query: string | null;
  position: number;
}

export interface WidgetError {
  error: { status: number; code: string; message: string };
}

export interface ItemsResult {
  kind: 'items';
  items: Array<{
    id: string;
    key: string;
    url?: string;
    title?: string;
    status?: string;
    priority?: string;
    assignee?: { id: string; displayName: string } | null;
  }>;
  nextCursor?: string;
}

export interface GroupsResult {
  kind: 'groups';
  groups: Array<{
    key: Record<string, unknown>;
    count: number;
    sum?: number;
    avg?: number | null;
  }>;
  /** Issues in all groups, also those past the limit */
  total: number;
  truncated?: true;
}

export interface SprintBlocker {
  key?: string;
  title?: string;
  hidden?: true;
}

export interface SprintEntry {
  id: string;
  name: string;
  goal: string | null;
  project: { key: string; name: string };
  startDate: string;
  endDate: string;
  daysLeft: number;
  issues: { total: number; done: number; inProgress: number; todo: number };
  points: { committed: number; done: number };
  blocked: Array<{
    key: string;
    title: string;
    assignee?: { displayName: string };
    blockedBy: SprintBlocker[];
  }>;
}

export interface SprintsResult {
  sprints: SprintEntry[];
}

export type WidgetResult = ItemsResult | GroupsResult | SprintsResult | WidgetError;

export interface RenderedWidget {
  id: string;
  type: WidgetType;
  title: string;
  result: WidgetResult;
}

export interface RenderedDashboard {
  dashboard: Dashboard;
  widgets: RenderedWidget[];
  /** The projects its widgets read that the viewer can see */
  projectIds: string[];
}

/** What a live block in a wiki page shows: widget titles and results, nothing about their source */
export interface EmbeddedBlock {
  widgets: RenderedWidget[];
  /** The projects its widgets read that the viewer can see */
  projectIds: string[];
}

export interface DashboardInput {
  name?: string;
  description?: string | null;
  layout?: { columns: number };
  visibility?: DashboardVisibility;
  teamId?: string;
  orgId?: string;
}

export interface WidgetInput {
  type?: WidgetType;
  title?: string;
  savedQueryId?: string | null;
  query?: string | null;
}

/** As many rows as a widget shows by default, also for a query not embedded yet */
const BLOCK_ROWS = 25;

/** Dashboards API client: shared boards of widgets, each rendered with the viewer's rights. */
export const dashboardsApi = {
  /** List the user's own dashboards and those shared with their teams and orgs. */
  list: () => get<DashboardListEntry[]>('/dashboards'),
  /**
   * Get one dashboard with its widgets as stored.
   * @param id
   */
  get: (id: string) => get<Dashboard & { widgets: DashboardWidget[] }>(`/dashboards/${id}`),
  /**
   * Render a dashboard: each widget's data with the current user's rights.
   * @param id
   */
  render: (id: string) => get<RenderedDashboard>(`/dashboards/${id}/render`),
  /**
   * Render a live block of a wiki page the current user can read.
   * @param pageId
   * @param embedId - The block's target as written in the Markdown
   */
  renderEmbedded: (pageId: string, embedId: string) =>
    post<EmbeddedBlock>('/dashboards/embedded', { pageId, embedId }),
  /**
   * Run a saved query with the current user's rights.
   * @param id
   */
  runSavedQuery: (id: string) =>
    post<ItemsResult | GroupsResult>(`/saved-filters/${id}/run`, { limit: BLOCK_ROWS }),
  /**
   * Run a query with the current user's rights.
   * @param query
   */
  runQuery: (query: string) =>
    post<ItemsResult | GroupsResult>('/query', { query, limit: BLOCK_ROWS }),
  /**
   * Create a dashboard.
   * @param data
   */
  create: (data: DashboardInput & { name: string }) => post<Dashboard>('/dashboards', data),
  /**
   * Change a dashboard's name, description, layout or sharing.
   * @param id
   * @param data
   */
  update: (id: string, data: DashboardInput) => patch<Dashboard>(`/dashboards/${id}`, data),
  /**
   * Delete a dashboard with its widgets.
   * @param id
   */
  delete: (id: string) => del(`/dashboards/${id}`),
  /**
   * Add a widget at the end of a dashboard.
   * @param id
   * @param data
   */
  addWidget: (id: string, data: WidgetInput) =>
    post<DashboardWidget>(`/dashboards/${id}/widgets`, data),
  /**
   * Change a widget.
   * @param id
   * @param widgetId
   * @param data
   */
  updateWidget: (id: string, widgetId: string, data: WidgetInput) =>
    patch<DashboardWidget>(`/dashboards/${id}/widgets/${widgetId}`, data),
  /**
   * Remove a widget.
   * @param id
   * @param widgetId
   */
  removeWidget: (id: string, widgetId: string) => del(`/dashboards/${id}/widgets/${widgetId}`),
  /**
   * Put the widgets in this order.
   * @param id
   * @param widgetIds
   */
  reorderWidgets: (id: string, widgetIds: string[]) =>
    put(`/dashboards/${id}/widgets/order`, { widgetIds }),
};
