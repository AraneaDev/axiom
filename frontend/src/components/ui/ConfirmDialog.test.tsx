import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <ConfirmDialog open={false} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders title and description when open', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete item?"
        description="This cannot be undone."
      />,
    );
    expect(screen.getByText('Delete item?')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open={true} onClose={vi.fn()} onConfirm={onConfirm} confirmLabel="Delete" />,
    );
    fireEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<ConfirmDialog open={true} onClose={onClose} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables buttons when loading is true', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loading={true}
        confirmLabel="Delete"
      />,
    );
    expect(screen.getByText('Cancel').closest('button')).toBeDisabled();
    expect(screen.getByText('Delete').closest('button')).toBeDisabled();
  });
});
