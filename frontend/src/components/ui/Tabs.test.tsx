import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Tabs } from './Tabs';

const tabs = [
  { key: 'general', label: 'General' },
  { key: 'security', label: 'Security' },
  { key: 'billing', label: 'Billing' },
];

describe('Tabs', () => {
  it('renders all tab labels', () => {
    render(<Tabs tabs={tabs} activeKey="general" onChange={vi.fn()} />);
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('Billing')).toBeInTheDocument();
  });

  it('applies active styling to the active tab', () => {
    render(<Tabs tabs={tabs} activeKey="security" onChange={vi.fn()} />);
    const securityBtn = screen.getByText('Security').closest('button');
    expect(securityBtn?.className).toContain('text-primary');
  });

  it('does not apply active styling to inactive tabs', () => {
    render(<Tabs tabs={tabs} activeKey="security" onChange={vi.fn()} />);
    const generalBtn = screen.getByText('General').closest('button');
    expect(generalBtn?.className).toContain('text-text-tertiary');
  });

  it('calls onChange with the tab key when clicked', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} activeKey="general" onChange={onChange} />);
    fireEvent.click(screen.getByText('Billing'));
    expect(onChange).toHaveBeenCalledWith('billing');
  });

  it('renders tab icons when provided', () => {
    const tabsWithIcons = [
      { key: 'a', label: 'Tab A', icon: <span data-testid="icon-a">A</span> },
    ];
    render(<Tabs tabs={tabsWithIcons} activeKey="a" onChange={vi.fn()} />);
    expect(screen.getByTestId('icon-a')).toBeInTheDocument();
  });

  it('renders the active indicator on the active tab', () => {
    const { container } = render(<Tabs tabs={tabs} activeKey="general" onChange={vi.fn()} />);
    const indicators = container.querySelectorAll('span.bg-primary');
    expect(indicators.length).toBe(1);
  });
});
