import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import {
  Skeleton,
  CardSkeleton,
  ListSkeleton,
  TableSkeleton,
  BoardSkeleton,
  DetailSkeleton,
  RepoSkeleton,
  CardGridSkeleton,
} from './Skeleton';

describe('Skeleton', () => {
  it('renders a div with animate-pulse class', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.className).toMatch(/animate-pulse/);
  });

  it('accepts additional className', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toMatch(/h-4/);
    expect(el.className).toMatch(/w-32/);
  });
});

describe('CardSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<CardSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it('produces DOM elements', () => {
    const { container } = render(<CardSkeleton />);
    expect(container.querySelectorAll('div').length).toBeGreaterThan(0);
  });
});

describe('ListSkeleton', () => {
  it('renders default 5 rows', () => {
    const { container } = render(<ListSkeleton />);
    // Each row has a flex container; check at least 5 inner row divs
    const rows = container.querySelectorAll('.flex.items-center.gap-3.p-4');
    expect(rows.length).toBe(5);
  });

  it('renders custom row count', () => {
    const { container } = render(<ListSkeleton rows={3} />);
    const rows = container.querySelectorAll('.flex.items-center.gap-3.p-4');
    expect(rows.length).toBe(3);
  });
});

describe('TableSkeleton', () => {
  it('renders default 5 rows', () => {
    const { container } = render(<TableSkeleton />);
    const rows = container.querySelectorAll('.flex.items-center.gap-4.p-3');
    expect(rows.length).toBe(5);
  });

  it('renders custom row and col count', () => {
    const { container } = render(<TableSkeleton rows={2} cols={3} />);
    const rows = container.querySelectorAll('.flex.items-center.gap-4.p-3');
    expect(rows.length).toBe(2);
  });
});

describe('BoardSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<BoardSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders 4 columns', () => {
    const { container } = render(<BoardSkeleton />);
    const cols = container.querySelectorAll('.w-72');
    expect(cols.length).toBe(4);
  });
});

describe('DetailSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<DetailSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it('produces multiple skeleton elements', () => {
    const { container } = render(<DetailSkeleton />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(5);
  });
});

describe('RepoSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<RepoSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it('produces multiple skeleton elements', () => {
    const { container } = render(<RepoSkeleton />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(5);
  });
});

describe('CardGridSkeleton', () => {
  it('renders default 6 cards', () => {
    const { container } = render(<CardGridSkeleton />);
    // Each card is a Card (div) inside the grid
    const grid = container.firstChild as HTMLElement;
    expect(grid).toBeTruthy();
    // 6 direct child card elements
    expect(grid.children.length).toBe(6);
  });

  it('renders custom card count', () => {
    const { container } = render(<CardGridSkeleton count={4} />);
    const grid = container.firstChild as HTMLElement;
    expect(grid.children.length).toBe(4);
  });
});
