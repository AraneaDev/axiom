import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';

import { Input } from './Input';

describe('Input', () => {
  it('renders with label', () => {
    render(<Input label="Email" id="email" />);
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('renders with placeholder', () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
  });

  it('handles onChange', () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('shows error message when error prop provided', () => {
    render(<Input error="Required field" />);
    expect(screen.getByText('Required field')).toBeInTheDocument();
  });

  it('shows hint text when hint prop provided', () => {
    render(<Input hint="Must be at least 8 characters" />);
    expect(screen.getByText('Must be at least 8 characters')).toBeInTheDocument();
  });

  it('hides hint when error is shown', () => {
    render(<Input hint="A hint" error="An error" />);
    expect(screen.getByText('An error')).toBeInTheDocument();
    expect(screen.queryByText('A hint')).not.toBeInTheDocument();
  });

  it('applies error styling when error is set', () => {
    render(<Input error="Bad input" />);
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('border-danger');
  });

  it('forwards ref correctly', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
