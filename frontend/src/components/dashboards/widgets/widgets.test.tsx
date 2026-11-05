import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { RenderedWidget } from '@/api/dashboards.api';

import { WidgetCard } from './WidgetCard';

const show = (widget: Partial<RenderedWidget> & Pick<RenderedWidget, 'type' | 'result'>) =>
  render(
    <MemoryRouter>
      <WidgetCard widget={{ id: 'w1', title: 'Open bugs', ...widget }} />
    </MemoryRouter>,
  );

const items = {
  kind: 'items' as const,
  items: [
    {
      id: 'i1',
      key: 'AXM-1',
      url: '/o/t/p/issues/1',
      title: 'Fix the login',
      status: 'In Progress',
      priority: 'HIGH',
      assignee: { id: 'u1', displayName: 'Ada Example' },
    },
    { id: 'i2', key: 'AXM-2', url: '/o/t/p/issues/2', title: 'Write the docs', status: 'Backlog' },
  ],
};

const groups = {
  kind: 'groups' as const,
  total: 7,
  groups: [
    { key: { status: 'Done' }, count: 5 },
    { key: { status: 'Backlog' }, count: 2 },
  ],
};

describe('WidgetCard', () => {
  it('shows the title on every widget', () => {
    show({ type: 'COUNT', result: { kind: 'groups', total: 3, groups: [] } });
    expect(screen.getByText('Open bugs')).toBeInTheDocument();
  });

  it('shows the error of a failed widget and no data', () => {
    show({
      type: 'COUNT',
      result: { error: { status: 404, code: 'ERROR', message: 'Saved query not found' } },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Saved query not found');
    expect(screen.queryByTestId('widget-count')).not.toBeInTheDocument();
  });

  describe('COUNT', () => {
    it('shows the total, also when it is zero', () => {
      show({ type: 'COUNT', result: { kind: 'groups', total: 0, groups: [] } });
      expect(screen.getByTestId('widget-count')).toHaveTextContent('0');
    });

    it('shows the total of a grouped query', () => {
      show({ type: 'COUNT', result: groups });
      expect(screen.getByTestId('widget-count')).toHaveTextContent('7');
    });
  });

  describe('TABLE', () => {
    it('shows items with links to them', () => {
      show({ type: 'TABLE', result: items });
      const row = screen.getByRole('row', { name: /AXM-1/ });
      expect(within(row).getByRole('link', { name: 'AXM-1' })).toHaveAttribute(
        'href',
        '/o/t/p/issues/1',
      );
      expect(within(row).getByText('Fix the login')).toBeInTheDocument();
      expect(within(row).getByText('In Progress')).toBeInTheDocument();
      expect(within(row).getByText('Ada Example')).toBeInTheDocument();
    });

    it('shows groups with their counts and aggregates', () => {
      show({
        type: 'TABLE',
        result: {
          kind: 'groups',
          total: 2,
          groups: [{ key: { assignee: { displayName: 'Ada Example' } }, count: 2, sum: 8 }],
        },
      });
      const row = screen.getByRole('row', { name: /Ada Example/ });
      expect(within(row).getByText('2')).toBeInTheDocument();
      expect(within(row).getByText('8')).toBeInTheDocument();
    });

    it('says so when nothing matches', () => {
      show({ type: 'TABLE', result: { kind: 'items', items: [] } });
      expect(screen.getByText('Nothing matches')).toBeInTheDocument();
    });
  });

  describe('LIST', () => {
    it('shows items as links', () => {
      show({ type: 'LIST', result: items });
      expect(screen.getByRole('link', { name: /Write the docs/ })).toHaveAttribute(
        'href',
        '/o/t/p/issues/2',
      );
    });

    it('shows groups with their counts', () => {
      show({ type: 'LIST', result: groups });
      expect(screen.getByText('Done')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('says when more groups exist than it shows', () => {
      show({ type: 'LIST', result: { ...groups, truncated: true } });
      expect(screen.getByText(/more than shown/i)).toBeInTheDocument();
    });
  });

  describe('BAR', () => {
    it('draws a labelled bar per group', () => {
      const { container } = show({ type: 'BAR', result: groups });
      expect(container.querySelectorAll('svg rect').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Done')).toBeInTheDocument();
      expect(screen.getByText('Backlog')).toBeInTheDocument();
    });

    it('scales the bars to the largest group', async () => {
      const { container } = show({ type: 'BAR', result: groups });
      await waitFor(() =>
        expect(Number(container.querySelector('svg rect')?.getAttribute('height'))).toBeGreaterThan(
          0,
        ),
      );
      const [done, backlog] = [...container.querySelectorAll('svg rect')].map((rect) =>
        Number(rect.getAttribute('height')),
      );
      expect(backlog / done).toBeCloseTo(2 / 5);
    });

    it('cuts a long label and shows the whole text on hover', async () => {
      const name = 'A very long group name that would run into the next bar';
      const { container } = show({
        type: 'BAR',
        result: {
          kind: 'groups',
          total: 2,
          groups: [
            { key: { status: name }, count: 1 },
            { key: { status: 'Other' }, count: 1 },
          ],
        },
      });
      expect(screen.queryByText(name)).not.toBeInTheDocument();
      fireEvent.mouseEnter(container.querySelector('svg g:has(rect)')!);
      expect(await screen.findByText(name)).toBeInTheDocument();
    });

    it('draws a bar for an aggregate by its value', async () => {
      show({
        type: 'BAR',
        result: {
          kind: 'groups',
          total: 1,
          groups: [{ key: { status: 'Done' }, count: 1, sum: 13 }],
        },
      });
      expect(await screen.findByText('13')).toBeInTheDocument();
    });

    it('names an empty key rather than leaving a gap', () => {
      show({
        type: 'BAR',
        result: { kind: 'groups', total: 1, groups: [{ key: { assignee: null }, count: 1 }] },
      });
      expect(screen.getByText('None')).toBeInTheDocument();
    });

    it('says so when nothing matches', () => {
      show({ type: 'BAR', result: { kind: 'groups', total: 0, groups: [] } });
      expect(screen.getByText('Nothing matches')).toBeInTheDocument();
    });
  });

  describe('SPRINT_OVERVIEW', () => {
    const sprint = {
      id: 's1',
      name: 'Sprint 12',
      goal: null,
      project: { key: 'AXM', name: 'Axiom' },
      startDate: '2026-11-01',
      endDate: '2026-11-10',
      daysLeft: 3,
      issues: { total: 10, done: 4, inProgress: 2, todo: 4 },
      points: { committed: 20, done: 8 },
      blocked: [
        {
          key: 'AXM-9',
          title: 'Stuck on review',
          blockedBy: [{ key: 'AXM-8', title: 'Review' }, { hidden: true as const }],
        },
      ],
    };

    it('shows each sprint with its progress', () => {
      show({ type: 'SPRINT_OVERVIEW', result: { sprints: [sprint] } });
      expect(screen.getByText('Sprint 12')).toBeInTheDocument();
      expect(screen.getByText('AXM')).toBeInTheDocument();
      expect(screen.getByText('3 days left')).toBeInTheDocument();
      expect(screen.getByText('4 of 10 issues done')).toBeInTheDocument();
      expect(screen.getByText('8 of 20 points')).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    });

    it('lists what is blocked and marks a hidden blocker as such', () => {
      show({ type: 'SPRINT_OVERVIEW', result: { sprints: [sprint] } });
      expect(screen.getByText(/AXM-9/)).toBeInTheDocument();
      expect(screen.getByText(/blocked by AXM-8, a hidden issue/i)).toBeInTheDocument();
    });

    it('says so past the end date and without sprints', () => {
      show({ type: 'SPRINT_OVERVIEW', result: { sprints: [{ ...sprint, daysLeft: -2 }] } });
      expect(screen.getByText('2 days over')).toBeInTheDocument();
    });

    it('says so without sprints', () => {
      show({ type: 'SPRINT_OVERVIEW', result: { sprints: [] } });
      expect(screen.getByText('No sprints')).toBeInTheDocument();
    });
  });
});
