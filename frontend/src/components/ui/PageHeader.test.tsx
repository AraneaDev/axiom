import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders the title', () => {
    render(<PageHeader title="My Project" />);
    expect(screen.getByRole('heading', { name: 'My Project' })).toBeInTheDocument();
  });

  it('renders the prefix badge when provided', () => {
    render(<PageHeader title="Issues" prefix="AXM" />);
    expect(screen.getByText('AXM')).toBeInTheDocument();
  });

  it('renders actions slot children', () => {
    render(
      <PageHeader title="Issues">
        <button>New Issue</button>
      </PageHeader>,
    );
    expect(screen.getByRole('button', { name: 'New Issue' })).toBeInTheDocument();
  });
});
