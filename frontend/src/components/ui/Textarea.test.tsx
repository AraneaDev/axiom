import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';

import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('renders a textarea element', () => {
    render(<Textarea />);
    expect(document.querySelector('textarea')).toBeInTheDocument();
  });

  it('renders the label when provided', () => {
    render(<Textarea label="Description" id="desc" />);
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });

  it('does not render the label when not provided', () => {
    const { container } = render(<Textarea />);
    expect(container.querySelector('label')).not.toBeInTheDocument();
  });

  it('shows error message', () => {
    render(<Textarea error="This field is required" />);
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('shows hint when no error', () => {
    render(<Textarea hint="Max 500 characters" />);
    expect(screen.getByText('Max 500 characters')).toBeInTheDocument();
  });

  it('does not show hint when error is present', () => {
    render(<Textarea error="Bad" hint="Helpful hint" />);
    expect(screen.queryByText('Helpful hint')).not.toBeInTheDocument();
  });

  it('applies error border class when error is present', () => {
    const { container } = render(<Textarea error="Error" />);
    const textarea = container.querySelector('textarea');
    expect(textarea?.className).toContain('border-danger');
  });

  it('forwards ref to textarea element', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('passes through standard textarea props', () => {
    render(<Textarea placeholder="Type here..." rows={5} />);
    const textarea = screen.getByPlaceholderText('Type here...');
    expect(textarea).toHaveAttribute('rows', '5');
  });

  it('handles onChange events', () => {
    const onChange = vi.fn();
    render(<Textarea onChange={onChange} placeholder="Type" />);
    fireEvent.change(screen.getByPlaceholderText('Type'), { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalled();
  });
});
