import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, LayoutDashboard, Pencil } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { dashboardsApi } from '@/api/dashboards.api';
import { WidgetCard } from '@/components/dashboards/widgets/WidgetCard';
import { PageLayout } from '@/components/layout/PageLayout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { dashboardRenderKey, useDashboardLive } from '@/hooks/useDashboardLive';
import { cn } from '@/lib/utils';

/** Whole class names, for Tailwind to find. One column below xl, whatever the dashboard asks. */
const COLUMN_CLASSES: Record<number, string> = {
  1: 'xl:grid-cols-1',
  2: 'lg:grid-cols-2 xl:grid-cols-2',
  3: 'lg:grid-cols-2 xl:grid-cols-3',
  4: 'lg:grid-cols-2 xl:grid-cols-4',
};
const DEFAULT_COLUMNS = 3;

/**
 * A dashboard with its widgets' data for the current user, kept current while it is open.
 */
export default function DashboardView() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: dashboardRenderKey(id),
    queryFn: () => dashboardsApi.render(id),
  });
  useDashboardLive(id, data?.projectIds ?? []);

  if (isLoading) {
    return (
      <PageLayout>
        <div className="grid gap-4 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </PageLayout>
    );
  }
  // A failed refetch keeps what is on screen: the next change brings a new one
  if (!data) {
    return (
      <PageLayout>
        <EmptyState
          card
          icon={<AlertTriangle />}
          title="Could not open this dashboard"
          description={error?.message}
        />
      </PageLayout>
    );
  }

  const { dashboard, widgets } = data;
  const editLink = `/dashboards/${dashboard.id}/edit`;
  return (
    <PageLayout>
      <PageHeader title={dashboard.name}>
        {dashboard.canEdit && (
          <Link to={editLink}>
            <Button variant="secondary" tabIndex={-1}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          </Link>
        )}
      </PageHeader>
      {dashboard.description && (
        <p className="-mt-2 mb-4 text-sm text-text-secondary">{dashboard.description}</p>
      )}
      {widgets.length === 0 ? (
        <EmptyState
          card
          icon={<LayoutDashboard />}
          title="No widgets yet"
          description={dashboard.canEdit ? 'Edit this dashboard to add the first one.' : undefined}
        />
      ) : (
        <div
          data-testid="dashboard-grid"
          className={cn(
            'grid gap-4 items-start',
            COLUMN_CLASSES[dashboard.layout.columns ?? DEFAULT_COLUMNS],
          )}
        >
          {widgets.map((widget) => (
            <WidgetCard key={widget.id} widget={widget} />
          ))}
        </div>
      )}
    </PageLayout>
  );
}
