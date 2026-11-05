import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { IssueListToolbar } from './IssueListToolbar';

const noop = () => {};

function renderToolbar(savedFilters: Parameters<typeof IssueListToolbar>[0]['savedFilters']) {
  return render(
    <IssueListToolbar
      searchInput=""
      onSearchChange={noop}
      onClearSearch={noop}
      hasActiveSearch={false}
      onToggleFilters={noop}
      activeFilterCount={0}
      sortField="createdAt"
      sortDir="desc"
      onToggleSort={noop}
      viewMode="list"
      onSetViewMode={noop}
      savedFilters={savedFilters}
      onApplySavedFilter={noop}
      onDeleteSavedFilter={vi.fn()}
      onSaveFilter={noop}
      canSaveFilter={false}
    />,
  );
}

describe('IssueListToolbar saved filters', () => {
  it('offers presets, not saved text queries, and deletes only what the user may change', () => {
    renderToolbar([
      { id: '1', name: 'Mine', query: { type: 'BUG' }, canEdit: true },
      { id: '2', name: 'Shared preset', query: { type: 'TASK' }, canEdit: false },
      { id: '3', name: 'Agent query', query: { kind: 'query', text: 'type = BUG' }, canEdit: true },
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Saved/ }));
    expect(screen.getByText('Mine')).toBeTruthy();
    expect(screen.getByText('Shared preset')).toBeTruthy();
    expect(screen.queryByText('Agent query')).toBeNull();
    expect(screen.getAllByTitle('Delete saved filter')).toHaveLength(1);
  });
});
