import { useQuery } from '@tanstack/react-query';
import { Bookmark, Code, LayoutDashboard, Plus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { dashboardsApi } from '@/api/dashboards.api';
import { savedFiltersApi } from '@/api/saved-filters.api';
import { isTextQuery } from '@/components/dashboards/saved-query';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { formatQueryEmbedTarget, type QueryEmbedTarget } from '@/editor-core/query-embed-target';

/** Where a block gets its data, as this form asks it */
export type QueryEmbedSource = 'dashboard' | 'saved' | 'inline';

/** query.run's own cap */
const QUERY_MAX = 1000;

const SOURCES: Array<{ value: QueryEmbedSource; label: string; icon: ReactNode }> = [
  { value: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { value: 'saved', label: 'Saved query', icon: <Bookmark className="h-4 w-4" /> },
  { value: 'inline', label: 'Inline query', icon: <Code className="h-4 w-4" /> },
];

interface QueryEmbedPickerProps {
  /** The source to start on */
  source: QueryEmbedSource;
  /** Called with the target to write in the Markdown */
  onPick: (target: string) => void;
  onClose: () => void;
}

/**
 * Choose what a live block in a page shows: a dashboard or saved query from the lists of what the
 * viewer may open, or a query typed here. The form says which of the three it is, so nothing is
 * guessed from what the text looks like.
 * @param root0
 * @param root0.source
 * @param root0.onPick
 * @param root0.onClose
 */
export function QueryEmbedPicker({ source: initial, onPick, onClose }: QueryEmbedPickerProps) {
  const [source, setSource] = useState<QueryEmbedSource>(initial);
  const [dashboardId, setDashboardId] = useState('');
  const [savedQueryId, setSavedQueryId] = useState('');
  const [query, setQuery] = useState('');

  const { data: dashboards = [] } = useQuery({
    queryKey: ['dashboards'],
    queryFn: () => dashboardsApi.list(),
    enabled: source === 'dashboard',
  });
  const { data: saved = [] } = useQuery({
    queryKey: ['saved-filters', 'all'],
    queryFn: () => savedFiltersApi.list(),
    enabled: source === 'saved',
  });
  const dashboardOptions = dashboards.map((row) => ({ value: row.id, label: row.name }));
  const savedOptions = saved
    .filter((row) => isTextQuery(row.query))
    .map((row) => ({ value: row.id, label: row.name }));

  const chosen = (): QueryEmbedTarget | null => {
    if (source === 'dashboard') return dashboardId ? { kind: 'dashboard', id: dashboardId } : null;
    if (source === 'saved') return savedQueryId ? { kind: 'savedQuery', id: savedQueryId } : null;
    return query.trim() ? { kind: 'inline', query: query.trim() } : null;
  };
  const target = chosen();

  return (
    <Modal open onClose={onClose} title="Add a live block" size="md">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (target) onPick(formatQueryEmbedTarget(target));
        }}
      >
        <div className="flex flex-wrap gap-2">
          {SOURCES.map(({ value, label, icon }) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={source === value ? 'primary' : 'outline'}
              onClick={() => setSource(value)}
            >
              {icon} {label}
            </Button>
          ))}
        </div>
        {source === 'dashboard' && (
          <div data-testid="dashboard-picker">
            <Select
              label="Dashboard"
              value={dashboardId}
              options={dashboardOptions}
              placeholder="Choose a dashboard"
              hint={dashboardOptions.length === 0 ? 'You have no dashboards yet' : undefined}
              onChange={(value) => setDashboardId(value as string)}
            />
          </div>
        )}
        {source === 'saved' && (
          <div data-testid="saved-query-picker">
            <Select
              label="Saved query"
              value={savedQueryId}
              options={savedOptions}
              placeholder="Choose a saved query"
              hint={
                savedOptions.length === 0 ? 'You have no saved queries written as text' : undefined
              }
              onChange={(value) => setSavedQueryId(value as string)}
            />
          </div>
        )}
        {source === 'inline' && (
          <Textarea
            label="Query"
            value={query}
            rows={3}
            maxLength={QUERY_MAX}
            className="font-mono"
            hint="For example: type = BUG AND priority = HIGH"
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button type="submit" disabled={!target}>
            <Plus className="h-4 w-4" /> Add block
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
