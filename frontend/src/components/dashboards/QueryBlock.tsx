import { AlertTriangle, LayoutDashboard } from 'lucide-react';
import { useContext } from 'react';

import {
  dashboardsApi,
  type EmbeddedBlock,
  type RenderedWidget,
  type WidgetResult,
} from '@/api/dashboards.api';
import { WidgetCard } from '@/components/dashboards/widgets/WidgetCard';
import { Card } from '@/components/ui/Card';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { parseQueryEmbedTarget, type QueryEmbedTarget } from '@/editor-core/nodes/query-embed';
import { dashboardRenderKey, useDashboardLive } from '@/hooks/useDashboardLive';
import { useRefusableQuery } from '@/hooks/useRefusableQuery';
import { cn } from '@/lib/utils';

import { QueryBlockScope } from './query-block-scope';

/**
 * A query shown on its own, as the server shows one embedded in a page.
 * @param result
 */
function queryBlock(result: WidgetResult): EmbeddedBlock {
  const widget: RenderedWidget = { id: 'block', type: 'TABLE', title: 'Query', result };
  return { widgets: [widget], projectIds: [] };
}

/**
 * Open what a block names, with the same rights the reader has anywhere: for a block being written,
 * which the saved page does not hold yet.
 * @param target - What it names
 */
async function openDirectly(target: QueryEmbedTarget): Promise<EmbeddedBlock> {
  switch (target.kind) {
    case 'dashboard':
      return dashboardsApi.render(target.id);
    case 'savedQuery':
      return queryBlock(await dashboardsApi.runSavedQuery(target.id));
    case 'inline':
      return queryBlock(await dashboardsApi.runQuery(target.query));
  }
}

async function loadBlock(
  raw: string,
  target: QueryEmbedTarget,
  pageId: string | undefined,
): Promise<EmbeddedBlock> {
  if (pageId) {
    try {
      return await dashboardsApi.renderEmbedded(pageId, raw);
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }
  return openDirectly(target);
}

function BlockMessage({ children }: { children: string }) {
  return (
    <Card className="not-prose my-3 p-4">
      <div role="alert" className="flex items-start gap-2 text-sm text-text-secondary">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>{children}</span>
      </div>
    </Card>
  );
}

function LiveBlock({ raw, target }: { raw: string; target: QueryEmbedTarget }) {
  const pageId = useContext(QueryBlockScope)?.pageId;
  const liveId = `embed:${pageId ?? ''}:${raw}`;
  const { data, isLoading, error, refusedWith } = useRefusableQuery(
    dashboardRenderKey(liveId),
    () => loadBlock(raw, target, pageId),
    { refetchOnWindowFocus: false },
  );
  useDashboardLive(liveId, data?.projectIds ?? []);

  if (isLoading) {
    return (
      <div className="not-prose my-3" data-testid="query-block-loading">
        <CardSkeleton />
      </div>
    );
  }
  // A refetch the server could not answer keeps what is on screen; one it refused does not
  if (!data) {
    return (
      <BlockMessage>{refusedWith ?? error?.message ?? 'Could not load this block'}</BlockMessage>
    );
  }
  if (data.widgets.length === 0) {
    return (
      <Card className="not-prose my-3 p-4">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <LayoutDashboard className="h-4 w-4 shrink-0" />
          <span>This dashboard has no widgets yet</span>
        </div>
      </Card>
    );
  }
  return (
    <div
      data-testid="query-block"
      className={cn(
        'not-prose my-3 grid gap-4 items-start',
        data.widgets.length > 1 && 'lg:grid-cols-2',
      )}
    >
      {data.widgets.map((widget) => (
        <WidgetCard key={widget.id} widget={widget} />
      ))}
    </div>
  );
}

/**
 * A live query or dashboard in a page, in view mode and in the editor alike: what it names, with the
 * reader's rights and kept current while it is open.
 * @param root0
 * @param root0.target - The block's target as written in the Markdown
 */
export function QueryBlock({ target }: { target: string }) {
  const parsed = parseQueryEmbedTarget(target);
  if (!parsed) return <BlockMessage>This block names nothing to show</BlockMessage>;
  return <LiveBlock raw={target} target={parsed} />;
}
