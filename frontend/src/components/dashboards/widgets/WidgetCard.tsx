import { AlertTriangle } from 'lucide-react';

import type { RenderedWidget } from '@/api/dashboards.api';
import { Card } from '@/components/ui/Card';

import { BarWidget } from './BarWidget';
import { CountWidget } from './CountWidget';
import { ListWidget } from './ListWidget';
import { SprintOverviewWidget } from './SprintOverviewWidget';
import { TableWidget } from './TableWidget';
import { isError, isGroups, isItems, isSprints } from './widget-data';
import { WIDGET_ICONS } from './widget-icons';

function WidgetBody({ widget }: { widget: RenderedWidget }) {
  const { result, type } = widget;
  if (isError(result)) {
    return (
      <div role="alert" className="flex items-start gap-2 text-sm text-danger">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>{result.error.message}</span>
      </div>
    );
  }
  if (isSprints(result)) return <SprintOverviewWidget sprints={result.sprints} />;
  if (isGroups(result)) {
    if (type === 'COUNT') return <CountWidget total={result.total} />;
    if (type === 'BAR') return <BarWidget result={result} />;
    if (type === 'LIST') return <ListWidget result={result} />;
    return <TableWidget result={result} />;
  }
  if (isItems(result)) {
    return type === 'LIST' ? <ListWidget result={result} /> : <TableWidget result={result} />;
  }
  return null;
}

/**
 * One widget on a dashboard: its title, and its data or its error. A failed widget says why and
 * leaves the others alone.
 * @param root0
 * @param root0.widget
 */
export function WidgetCard({ widget }: { widget: RenderedWidget }) {
  const Icon = WIDGET_ICONS[widget.type];
  return (
    <Card className="flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <Icon className="h-4 w-4 shrink-0 text-text-tertiary" />
        <h2 className="text-sm font-medium text-text truncate">{widget.title}</h2>
      </div>
      <div className="px-4 pb-4 min-w-0 flex-1">
        <WidgetBody widget={widget} />
      </div>
    </Card>
  );
}
