import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, LayoutDashboard, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { dashboardsApi } from '@/api/dashboards.api';
import { sharingComplete, sharingInput, type Sharing } from '@/components/dashboards/sharing';
import { SharingFields } from '@/components/dashboards/SharingFields';
import { PageLayout } from '@/components/layout/PageLayout';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';

const VISIBILITY_LABELS = { PRIVATE: 'Private', TEAM: 'Team', ORG: 'Organization' };

function CreateDashboardModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [sharing, setSharing] = useState<Sharing>({
    visibility: 'PRIVATE',
    teamId: null,
    orgId: null,
  });
  const create = useMutationWithToast(
    () => dashboardsApi.create({ name: name.trim(), ...sharingInput(sharing) }),
    {
      successMessage: 'Dashboard created',
      errorMessage: 'Could not create the dashboard',
      invalidateKeys: [['dashboards']],
      onSuccess: (created) => navigate(`/dashboards/${created.id}/edit`),
    },
  );
  return (
    <Modal open onClose={onClose} title="New dashboard" size="sm">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <SharingFields value={sharing} onChange={setSharing} />
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            type="submit"
            disabled={!name.trim() || !sharingComplete(sharing) || create.isPending}
          >
            <Plus className="h-4 w-4" /> Create
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/**
 * The dashboards the user made and those shared with their teams and orgs.
 */
export default function DashboardList() {
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboards'],
    queryFn: dashboardsApi.list,
  });

  const newButton = (
    <Button onClick={() => setCreating(true)}>
      <Plus className="h-4 w-4" /> New dashboard
    </Button>
  );

  return (
    <PageLayout>
      <PageHeader title="Dashboards">{newButton}</PageHeader>
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}
      {error && (
        <EmptyState
          card
          icon={<AlertTriangle />}
          title="Could not load the dashboards"
          description={error.message}
        />
      )}
      {data?.length === 0 && (
        <EmptyState
          card
          icon={<LayoutDashboard />}
          title="No dashboards yet"
          description="A dashboard shows saved or inline queries as live numbers, tables and charts."
          action={newButton}
        />
      )}
      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {data.map((dashboard) => (
            <Link
              key={dashboard.id}
              to={`/dashboards/${dashboard.id}`}
              className="rounded-lg border border-border bg-surface p-4 hover:border-primary/50 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-2 mb-1">
                <LayoutDashboard className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate font-medium text-text">
                  {dashboard.name}
                </span>
                <Badge variant="outline" size="sm">
                  {VISIBILITY_LABELS[dashboard.visibility]}
                </Badge>
              </div>
              {dashboard.description && (
                <p className="text-sm text-text-secondary line-clamp-2">{dashboard.description}</p>
              )}
              <p className="mt-2 text-xs text-text-tertiary">
                {`${dashboard.widgetCount} ${dashboard.widgetCount === 1 ? 'widget' : 'widgets'}`}
              </p>
            </Link>
          ))}
        </div>
      )}
      {creating && <CreateDashboardModal onClose={() => setCreating(false)} />}
    </PageLayout>
  );
}
