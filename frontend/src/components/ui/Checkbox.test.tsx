import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('renders without crashing', () => {
    render(<Checkbox />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('reflects checked state', () => {
    render(<Checkbox checked={true} onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('calls onChange when clicked', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('renders label and associates it with the input', () => {
    render(<Checkbox id="cb1" label="Enable feature" />);
    expect(screen.getByText('Enable feature')).toBeInTheDocument();
    expect(screen.getByLabelText('Enable feature')).toBeInTheDocument();
  });

  it('renders error and hint text', () => {
    const { rerender } = render(<Checkbox label="Field" error="Required" hint="Some hint" />);
    expect(screen.getByText('Required')).toBeInTheDocument();
    // hint should be hidden when error is present
    expect(screen.queryByText('Some hint')).not.toBeInTheDocument();

    rerender(<Checkbox label="Field" hint="Some hint" />);
    expect(screen.getByText('Some hint')).toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Checkbox disabled />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});
