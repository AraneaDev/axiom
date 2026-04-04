import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { IssueTypeIcon } from './IssueTypeIcon';

describe('IssueTypeIcon', () => {
  it('renders an svg for a known type', () => {
    const { container } = render(<IssueTypeIcon type="BUG" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders an svg for unknown type (fallback to CheckSquare)', () => {
    const { container } = render(<IssueTypeIcon type="UNKNOWN" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('applies additional className to the icon', () => {
    const { container } = render(<IssueTypeIcon type="TASK" className="text-primary" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('text-primary');
  });
});
