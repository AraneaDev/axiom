import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CopyInput } from './CopyInput';

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe('CopyInput', () => {
  it('renders the value in the input', () => {
    render(<CopyInput value="https://example.com/token" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('https://example.com/token');
  });

  it('renders a copy button', () => {
    render(<CopyInput value="abc" label="Token" />);
    expect(screen.getByRole('button', { name: 'Copy Token' })).toBeInTheDocument();
  });

  it('calls clipboard.writeText with the value when copy button is clicked', async () => {
    render(<CopyInput value="my-secret-token" />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('my-secret-token');
  });
});
