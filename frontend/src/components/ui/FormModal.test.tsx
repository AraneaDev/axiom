import { render, screen, fireEvent } from '@testing-library/react';
import { Save } from 'lucide-react';
import { describe, it, expect, vi } from 'vitest';

import { FormModal } from './FormModal';

describe('FormModal', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <FormModal
        open={false}
        onClose={vi.fn()}
        title="Create"
        onSubmit={vi.fn()}
        isPending={false}
        submitLabel="Save"
        submitIcon={<Save className="h-4 w-4" />}
      >
        <input />
      </FormModal>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders title and children when open', () => {
    render(
      <FormModal
        open={true}
        onClose={vi.fn()}
        title="Create Item"
        onSubmit={vi.fn()}
        isPending={false}
        submitLabel="Save"
        submitIcon={<Save className="h-4 w-4" />}
      >
        <input data-testid="field" />
      </FormModal>,
    );
    expect(screen.getByText('Create Item')).toBeInTheDocument();
    expect(screen.getByTestId('field')).toBeInTheDocument();
  });

  it('calls onSubmit when submit button is clicked', () => {
    const onSubmit = vi.fn();
    render(
      <FormModal
        open={true}
        onClose={vi.fn()}
        title="Form"
        onSubmit={onSubmit}
        isPending={false}
        submitLabel="Save"
        submitIcon={<Save className="h-4 w-4" />}
      >
        <input />
      </FormModal>,
    );
    fireEvent.click(screen.getByText('Save'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when cancel button is clicked', () => {
    const onClose = vi.fn();
    render(
      <FormModal
        open={true}
        onClose={onClose}
        title="Form"
        onSubmit={vi.fn()}
        isPending={false}
        submitLabel="Save"
        submitIcon={<Save className="h-4 w-4" />}
      >
        <input />
      </FormModal>,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables submit button when isPending or disabled', () => {
    const { rerender } = render(
      <FormModal
        open={true}
        onClose={vi.fn()}
        title="Form"
        onSubmit={vi.fn()}
        isPending={true}
        submitLabel="Save"
        submitIcon={<Save className="h-4 w-4" />}
      >
        <input />
      </FormModal>,
    );
    expect(screen.getByText('Save').closest('button')).toBeDisabled();

    rerender(
      <FormModal
        open={true}
        onClose={vi.fn()}
        title="Form"
        onSubmit={vi.fn()}
        isPending={false}
        disabled={true}
        submitLabel="Save"
        submitIcon={<Save className="h-4 w-4" />}
      >
        <input />
      </FormModal>,
    );
    expect(screen.getByText('Save').closest('button')).toBeDisabled();
  });

  it('renders error message when error prop is provided', () => {
    render(
      <FormModal
        open={true}
        onClose={vi.fn()}
        title="Form"
        onSubmit={vi.fn()}
        isPending={false}
        error="Something went wrong"
        submitLabel="Save"
        submitIcon={<Save className="h-4 w-4" />}
      >
        <input />
      </FormModal>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
