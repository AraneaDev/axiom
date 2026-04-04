import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Card, CardHeader, CardContent } from './Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('applies additional className', () => {
    const { container } = render(<Card className="custom-class">content</Card>);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('renders CardHeader and CardContent children', () => {
    render(
      <Card>
        <CardHeader>Header text</CardHeader>
        <CardContent>Body text</CardContent>
      </Card>,
    );
    expect(screen.getByText('Header text')).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
  });
});
