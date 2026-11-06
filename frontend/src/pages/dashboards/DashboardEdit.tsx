import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Eye,
  LayoutDashboard,
  Pencil,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import {
  dashboardsApi,
  type Dashboard,
  type DashboardWidget,
  type WidgetInput,
} from '@/api/dashboards.api';
import { savedFiltersApi } from '@/api/saved-filters.api';
import { sharingComplete, sharingInput, type Sharing } from '@/components/dashboards/sharing';
import { SharingFields } from '@/components/dashboards/SharingFields';
import { WidgetFormModal } from '@/components/dashboards/WidgetFormModal';
import { WIDGET_ICONS } from '@/components/dashboards/widgets/widget-icons';
import { PageLayout } from '@/components/layout/PageLayout';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Select } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import { dashboardRenderKey } from '@/hooks/useDashboardLive';
import { useFormError } from '@/hooks/useFormError';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useRefusableQuery } from '@/hooks/useRefusableQuery';

const COLUMN_OPTIONS = [1, 2, 3, 4].map((columns) => ({
  value: String(columns),
  label: `${columns} ${columns === 1 ? 'column' : 'columns'}`,
}));
const DEFAULT_COLUMNS = 3;

function SettingsForm({ dashboard }: { dashboard: Dashboard }) {
  const [name, setName] = useState(dashboard.name);
  const [description, setDescription] = useState(dashboard.description ?? '');
  const [columns, setColumns] = useState(dashboard.layout.columns ?? DEFAULT_COLUMNS);
  const [sharing, setSharing] = useState<Sharing>({
    visibility: dashboard.visibility,
    teamId: dashboard.teamId,
    orgId: dashboard.orgId,
  });
  const save = useMutationWithToast(
    () =>
      dashboardsApi.update(dashboard.id, {
        name: name.trim(),
        description: description.trim() || null,
        layout: { columns },
        ...sharingInput(sharing),
      }),
    {
      successMessage: 'Dashboard saved',
      errorMessage: 'Could not save the dashboard',
      invalidateKeys: [
        ['dashboards'],
        ['dashboards', dashboard.id],
        dashboardRenderKey(dashboard.id),
      ],
    },
  );
  return (
    <Card className="p-4">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Textarea
          label="Description"
          value={description}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Select
          label="Layout"
          value={String(columns)}
          options={COLUMN_OPTIONS}
          onChange={(value) => setColumns(Number(value))}
        />
        <SharingFields value={sharing} onChange={setSharing} />
        <div>
          <Button
            type="submit"
            disabled={!name.trim() || !sharingComplete(sharing) || save.isPending}
          >
            <Save className="h-4 w-4" /> Save settings
          </Button>
        </div>
      </form>
    </Card>
  );
}

function WidgetRow({
  widget,
  source,
  isFirst,
  isLast,
  onMove,
  onEdit,
  onRemove,
}: {
  widget: DashboardWidget;
  source: string | null;
  isFirst: boolean;
  isLast: boolean;
  onMove: (by: -1 | 1) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const Icon = WIDGET_ICONS[widget.type];
  return (
    <li
      data-testid={`widget-row-${widget.title}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary transition-colors"
    >
      <Icon className="h-4 w-4 shrink-0 text-text-tertiary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">{widget.title}</p>
        {source && <p className="truncate font-mono text-xs text-text-secondary">{source}</p>}
      </div>
      <Button
        variant="ghost"
        size="xs"
        title="Move up"
        aria-label="Move up"
        disabled={isFirst}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        title="Move down"
        aria-label="Move down"
        disabled={isLast}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        title="Edit widget"
        aria-label="Edit widget"
        onClick={onEdit}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        title="Remove widget"
        aria-label="Remove widget"
        onClick={onRemove}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

/**
 * Change a dashboard: its settings and sharing, and its widgets and their order.
 */
export default function DashboardEdit() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { error: widgetError, setError: setWidgetError, clearError } = useFormError();
  /** The widget being changed, 'new' for one being added */
  const [editing, setEditing] = useState<DashboardWidget | 'new' | null>(null);
  const [removing, setRemoving] = useState<DashboardWidget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const queryKey = ['dashboards', id];
  const { data, isLoading, error, refusedWith } = useRefusableQuery(queryKey, () =>
    dashboardsApi.get(id),
  );
  const { data: saved } = useQuery({
    queryKey: ['saved-filters', 'all'],
    queryFn: () => savedFiltersApi.list(),
  });
  const widgets = data?.widgets ?? [];
  const invalidateKeys = [queryKey, dashboardRenderKey(id), ['dashboards']];

  useEffect(clearError, [editing, clearError]);

  const saveWidget = useMutationWithToast(
    (input: WidgetInput) =>
      editing && editing !== 'new'
        ? dashboardsApi.updateWidget(id, editing.id, input)
        : dashboardsApi.addWidget(id, input),
    {
      successMessage: 'Widget saved',
      errorMessage: '',
      invalidateKeys,
      onSuccess: () => setEditing(null),
      onError: (err) => setWidgetError(err.message),
    },
  );
  const removeWidget = useMutationWithToast(
    (widgetId: string) => dashboardsApi.removeWidget(id, widgetId),
    {
      successMessage: 'Widget removed',
      errorMessage: 'Could not remove the widget',
      invalidateKeys,
      onSuccess: () => setRemoving(null),
    },
  );
  const reorder = useMutationWithToast(
    (widgetIds: string[]) => dashboardsApi.reorderWidgets(id, widgetIds),
    { successMessage: '', errorMessage: 'Could not move the widget', invalidateKeys },
  );
  const deleteDashboard = useMutationWithToast(() => dashboardsApi.delete(id), {
    successMessage: 'Dashboard deleted',
    errorMessage: 'Could not delete the dashboard',
    invalidateKeys: [['dashboards']],
    onSuccess: () => navigate('/dashboards'),
  });

  const move = (index: number, by: -1 | 1) => {
    const order = widgets.map((widget) => widget.id);
    [order[index], order[index + by]] = [order[index + by], order[index]];
    reorder.mutate(order);
  };

  const sourceOf = (widget: DashboardWidget): string | null => {
    if (widget.query) return widget.query;
    if (!widget.savedQueryId) return null;
    return saved?.find((row) => row.id === widget.savedQueryId)?.name ?? 'A saved query';
  };

  if (isLoading) {
    return (
      <PageLayout>
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-64 w-full" />
      </PageLayout>
    );
  }
  if (!data) {
    return (
      <PageLayout>
        <EmptyState
          card
          icon={<AlertTriangle />}
          title="Could not open this dashboard"
          description={refusedWith ?? error?.message}
        />
      </PageLayout>
    );
  }
  const backLink = (
    <ButtonLink to={`/dashboards/${id}`} variant="secondary">
      <Eye className="h-4 w-4" /> View
    </ButtonLink>
  );
  if (!data.canEdit) {
    return (
      <PageLayout>
        <PageHeader title={data.name}>{backLink}</PageHeader>
        <EmptyState
          card
          icon={<ArrowLeft />}
          title="You cannot change this dashboard"
          description="Its creator can, and the admins of the team or organization it is shared with."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader title={`Edit ${data.name}`}>
        {backLink}
        <Button variant="danger" onClick={() => setDeleting(true)}>
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start">
        <SettingsForm key={data.id} dashboard={data} />
        <Card>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium text-text">Widgets</h2>
            <Button size="sm" disabled={widgets.length >= 24} onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> Add widget
            </Button>
          </div>
          {widgets.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<LayoutDashboard />}
                title="No widgets yet"
                description="Add one from a saved query or a query written here."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border-light">
              {widgets.map((widget, index) => (
                <WidgetRow
                  key={widget.id}
                  widget={widget}
                  source={sourceOf(widget)}
                  isFirst={index === 0}
                  isLast={index === widgets.length - 1}
                  onMove={(by) => move(index, by)}
                  onEdit={() => setEditing(widget)}
                  onRemove={() => setRemoving(widget)}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {editing && (
        <WidgetFormModal
          widget={editing === 'new' ? undefined : editing}
          error={widgetError}
          saving={saveWidget.isPending}
          onSave={(input) => {
            clearError();
            saveWidget.mutate(input);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) removeWidget.mutate(removing.id);
        }}
        title="Remove widget"
        description={`Remove "${removing?.title}" from this dashboard?`}
        confirmLabel="Remove"
        loading={removeWidget.isPending}
      />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => deleteDashboard.mutate()}
        title="Delete dashboard"
        description="This deletes the dashboard and its widgets for everyone it is shared with. Saved queries stay."
        confirmLabel="Delete"
        loading={deleteDashboard.isPending}
      />
    </PageLayout>
  );
}
