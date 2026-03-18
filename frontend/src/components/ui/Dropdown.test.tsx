import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { Dropdown, DropdownItem, Select } from './Dropdown';

describe('Dropdown', () => {
  it('does not show menu by default', () => {
    render(
      <Dropdown trigger={<button>Open</button>}>
        <DropdownItem>Item 1</DropdownItem>
      </Dropdown>,
    );
    expect(screen.queryByText('Item 1')).not.toBeInTheDocument();
  });

  it('shows menu when trigger is clicked', () => {
    render(
      <Dropdown trigger={<button>Open</button>}>
        <DropdownItem>Item 1</DropdownItem>
      </Dropdown>,
    );
    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByText('Item 1')).toBeInTheDocument();
  });

  it('toggles menu on repeated clicks', () => {
    render(
      <Dropdown trigger={<button>Open</button>}>
        <DropdownItem>Item 1</DropdownItem>
      </Dropdown>,
    );
    const trigger = screen.getByText('Open');
    fireEvent.click(trigger);
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByText('Item 1')).not.toBeInTheDocument();
  });

  it('closes when clicking outside', () => {
    render(
      <div>
        <Dropdown trigger={<button>Open</button>}>
          <DropdownItem>Item 1</DropdownItem>
        </Dropdown>
        <button>Outside</button>
      </div>,
    );
    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('Outside'));
    expect(screen.queryByText('Item 1')).not.toBeInTheDocument();
  });
});

describe('DropdownItem', () => {
  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<DropdownItem onClick={onClick}>Click me</DropdownItem>);
    fireEvent.click(screen.getByText('Click me'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when disabled prop is true', () => {
    render(<DropdownItem disabled>Disabled</DropdownItem>);
    expect(screen.getByText('Disabled').closest('button')).toBeDisabled();
  });
});

describe('Select', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
  ];

  it('renders the label', () => {
    render(<Select label="Pick one" options={options} />);
    expect(screen.getByText('Pick one')).toBeInTheDocument();
  });

  it('shows placeholder when no value selected', () => {
    render(<Select options={options} placeholder="Choose..." />);
    expect(screen.getByText('Choose...')).toBeInTheDocument();
  });

  it('shows selected value label', () => {
    render(<Select options={options} value="b" />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('opens options on click', () => {
    render(<Select options={options} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('calls onChange with selected value', () => {
    const onChange = vi.fn();
    render(<Select options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Beta'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('shows error message', () => {
    render(<Select options={options} error="Required" />);
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('shows hint when no error', () => {
    render(<Select options={options} hint="Pick wisely" />);
    expect(screen.getByText('Pick wisely')).toBeInTheDocument();
  });

  it('does not show hint when error is present', () => {
    render(<Select options={options} error="Bad" hint="Pick wisely" />);
    expect(screen.queryByText('Pick wisely')).not.toBeInTheDocument();
  });

  it('handles multiple selection', () => {
    const onChange = vi.fn();
    render(<Select options={options} multiple value={['a']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Beta'));
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  });

  it('removes chip in multiple mode', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Select options={options} multiple value={['a', 'b']} onChange={onChange} />,
    );
    // Click the X icon on the first chip
    const removeButtons = container.querySelectorAll('svg.lucide-x');
    expect(removeButtons.length).toBe(2);
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith(['b']);
  });
});
