import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ToastProvider, useToast } from './Toast';

function ToastTrigger() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success('Success message')}>Show Success</button>
      <button onClick={() => toast.error('Error message')}>Show Error</button>
      <button onClick={() => toast.info('Info message')}>Show Info</button>
    </div>
  );
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders success toast with correct styling', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Show Success'));
    const toast = screen.getByText('Success message');
    expect(toast).toBeInTheDocument();
    expect(toast.closest('div[class*="bg-success"]')).toBeTruthy();
  });

  it('renders error toast with correct styling', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Show Error'));
    const toast = screen.getByText('Error message');
    expect(toast).toBeInTheDocument();
    expect(toast.closest('div[class*="bg-danger"]')).toBeTruthy();
  });

  it('renders info toast with correct styling', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Show Info'));
    const toast = screen.getByText('Info message');
    expect(toast).toBeInTheDocument();
    expect(toast.closest('div[class*="bg-primary"]')).toBeTruthy();
  });

  it('auto-dismisses after timeout', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Show Success'));
    expect(screen.getByText('Success message')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4500);
    });

    expect(screen.queryByText('Success message')).not.toBeInTheDocument();
  });

  it('can be manually dismissed', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Show Success'));
    expect(screen.getByText('Success message')).toBeInTheDocument();

    const dismissBtn = screen.getByTitle('Dismiss');
    fireEvent.click(dismissBtn);

    expect(screen.queryByText('Success message')).not.toBeInTheDocument();
  });
});
