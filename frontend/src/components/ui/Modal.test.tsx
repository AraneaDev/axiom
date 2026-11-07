import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { Modal, ModalFooter } from './Modal';

describe('Modal', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <Modal open={false} onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders children when open is true', () => {
    render(
      <Modal open={true} onClose={vi.fn()}>
        <p>Modal content</p>
      </Modal>,
    );
    expect(screen.getByText('Modal content')).toBeInTheDocument();
  });

  it('renders the title when provided', () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="My Title">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByText('My Title')).toBeInTheDocument();
  });

  it('does not render title header when title is not provided', () => {
    render(
      <Modal open={true} onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );
    // The backdrop is the div with bg-backdrop class
    const backdrop = document.querySelector('.bg-backdrop');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sets body overflow to hidden when open', () => {
    render(
      <Modal open={true} onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body overflow when closed', () => {
    const { rerender } = render(
      <Modal open={true} onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    rerender(
      <Modal open={false} onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('');
  });
});

describe('Modal focus', () => {
  it('moves focus into the dialog when it opens, and not again when onClose changes identity', async () => {
    const field = (
      <>
        <input aria-label="first" />
        <input aria-label="second" />
      </>
    );
    const { rerender } = render(
      <Modal open={true} onClose={() => {}}>
        {field}
      </Modal>,
    );
    await waitFor(() => expect(screen.getByLabelText('first')).toHaveFocus());

    // The user moves on to the second field
    screen.getByLabelText('second').focus();
    expect(screen.getByLabelText('second')).toHaveFocus();

    // A parent that re-renders with a new callback must not pull focus back
    rerender(
      <Modal open={true} onClose={() => {}}>
        {field}
      </Modal>,
    );
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(screen.getByLabelText('second')).toHaveFocus();
  });

  it('calls the latest onClose on Escape', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Modal open={true} onClose={first}>
        <p>Body</p>
      </Modal>,
    );
    rerender(
      <Modal open={true} onClose={second}>
        <p>Body</p>
      </Modal>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('ModalFooter', () => {
  it('renders children', () => {
    render(
      <ModalFooter>
        <button>Save</button>
      </ModalFooter>,
    );
    expect(screen.getByText('Save')).toBeInTheDocument();
  });
});
