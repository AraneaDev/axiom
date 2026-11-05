import { useQuery } from '@tanstack/react-query';
import { Bookmark, BookmarkPlus, Code, Save, X } from 'lucide-react';
import { useState } from 'react';

import type { DashboardWidget, WidgetInput, WidgetType } from '@/api/dashboards.api';
import { savedFiltersApi } from '@/api/saved-filters.api';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { useFormError } from '@/hooks/useFormError';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';

import { sharingComplete, sharingInput, type Sharing } from './sharing';
import { SharingFields } from './SharingFields';

const TYPE_OPTIONS: Array<{ value: WidgetType; label: string }> = [
  { value: 'COUNT', label: 'Count' },
  { value: 'TABLE', label: 'Table' },
  { value: 'LIST', label: 'List' },
  { value: 'BAR', label: 'Bar chart' },
  { value: 'SPRINT_OVERVIEW', label: 'Sprint overview' },
];

/**
 * Presets the issue list saved have no query text: only rows written as text can be picked.
 * @param query - The saved row's stored query
 */
const isTextQuery = (query: unknown) =>
  typeof query === 'object' && query !== null && (query as { kind?: unknown }).kind === 'query';

/**
 * Keep the query being written as a saved query, for this widget and others.
 * @param root0
 * @param root0.text
 * @param root0.onSaved
 */
function SaveQueryFields({ text, onSaved }: { text: string; onSaved: (id: string) => void }) {
  const [name, setName] = useState('');
  const [sharing, setSharing] = useState<Sharing>({
    visibility: 'PRIVATE',
    teamId: null,
    orgId: null,
  });
  const { error, setError, clearError } = useFormError();
  const save = useMutationWithToast(
    () => savedFiltersApi.createQuery({ name: name.trim(), text, ...sharingInput(sharing) }),
    {
      successMessage: 'Query saved',
      errorMessage: '',
      invalidateKeys: [['saved-filters']],
      onSuccess: (saved) => onSaved(saved.id),
      onError: (err) => setError(err.message),
    },
  );
  const ready = !!name.trim() && sharingComplete(sharing) && !save.isPending;
  const submit = () => {
    clearError();
    save.mutate();
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <Input
        label="Query name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(event) => {
          // Enter here saves the query, not the widget around it
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (ready) submit();
        }}
      />
      <SharingFields value={sharing} onChange={setSharing} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div>
        <Button type="button" size="sm" disabled={!ready} onClick={submit}>
          <Save className="h-4 w-4" /> Save query
        </Button>
      </div>
    </div>
  );
}

interface WidgetFormModalProps {
  /** The widget to change, or nothing to make a new one */
  widget?: DashboardWidget;
  /** Why the server refused the last save */
  error?: string;
  saving: boolean;
  onSave: (input: WidgetInput) => void;
  onClose: () => void;
}

/**
 * Make or change a widget: its title, its type and where it gets its data.
 * @param root0
 * @param root0.widget
 * @param root0.error
 * @param root0.saving
 * @param root0.onSave
 * @param root0.onClose
 */
export function WidgetFormModal({ widget, error, saving, onSave, onClose }: WidgetFormModalProps) {
  const [title, setTitle] = useState(widget?.title ?? '');
  const [type, setType] = useState<WidgetType>(widget?.type ?? 'COUNT');
  const [source, setSource] = useState<'inline' | 'saved'>(
    widget?.savedQueryId ? 'saved' : 'inline',
  );
  const [query, setQuery] = useState(widget?.query ?? '');
  const [savedQueryId, setSavedQueryId] = useState(widget?.savedQueryId ?? '');
  const [savingQuery, setSavingQuery] = useState(false);

  const { data: saved = [] } = useQuery({
    queryKey: ['saved-filters', 'all'],
    queryFn: () => savedFiltersApi.list(),
  });
  const savedOptions = saved
    .filter((row) => isTextQuery(row.query))
    .map((row) => ({ value: row.id, label: row.name }));

  const needsQuery = type !== 'SPRINT_OVERVIEW';
  const hasSource = !needsQuery || (source === 'saved' ? !!savedQueryId : !!query.trim());

  const submit = () => {
    const base = { type, title: title.trim() };
    const sourced = !needsQuery
      ? { savedQueryId: null, query: null }
      : source === 'saved'
        ? { savedQueryId, query: null }
        : { query: query.trim(), savedQueryId: null };
    if (widget) {
      onSave({ ...base, ...sourced });
      return;
    }
    // A new widget only names the source it has
    onSave({
      ...base,
      ...(sourced.query ? { query: sourced.query } : {}),
      ...(sourced.savedQueryId ? { savedQueryId: sourced.savedQueryId } : {}),
    });
  };

  return (
    <Modal open onClose={onClose} title={widget ? 'Edit widget' : 'Add widget'} size="md">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <Select
          label="Type"
          value={type}
          options={TYPE_OPTIONS}
          onChange={(value) => setType(value as WidgetType)}
        />
        {needsQuery && (
          <>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={source === 'inline' ? 'primary' : 'outline'}
                onClick={() => setSource('inline')}
              >
                <Code className="h-4 w-4" /> Inline query
              </Button>
              <Button
                type="button"
                size="sm"
                variant={source === 'saved' ? 'primary' : 'outline'}
                onClick={() => setSource('saved')}
              >
                <Bookmark className="h-4 w-4" /> Saved query
              </Button>
            </div>
            {source === 'inline' ? (
              <>
                <Textarea
                  label="Query"
                  value={query}
                  rows={3}
                  className="font-mono"
                  hint={
                    type === 'BAR'
                      ? 'A bar chart needs GROUP BY, as in: WHERE type = BUG GROUP BY status'
                      : 'For example: type = BUG AND priority = HIGH'
                  }
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!query.trim()}
                    onClick={() => setSavingQuery((open) => !open)}
                  >
                    <BookmarkPlus className="h-4 w-4" /> Save as query
                  </Button>
                </div>
                {savingQuery && (
                  <SaveQueryFields
                    text={query.trim()}
                    onSaved={(id) => {
                      setSavedQueryId(id);
                      setSource('saved');
                      setSavingQuery(false);
                    }}
                  />
                )}
              </>
            ) : (
              <div data-testid="saved-query-picker">
                <Select
                  label="Saved query"
                  value={savedQueryId}
                  options={savedOptions}
                  placeholder="Choose a saved query"
                  hint={
                    savedOptions.length === 0
                      ? 'You have no saved queries written as text'
                      : undefined
                  }
                  onChange={(value) => setSavedQueryId(value as string)}
                />
              </div>
            )}
          </>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button type="submit" disabled={!title.trim() || !hasSource || saving}>
            <Save className="h-4 w-4" /> Save widget
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
