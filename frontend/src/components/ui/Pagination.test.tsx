import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { Pagination } from './Pagination';

describe('Pagination', () => {
  it('renders page indicator showing current page and total', () => {
    render(<Pagination total={50} limit={10} offset={0} onPageChange={vi.fn()} />);
    expect(screen.getByText('1 / 5')).toBeInTheDocument();
  });

  it('renders showing items text', () => {
    render(<Pagination total={50} limit={10} offset={0} onPageChange={vi.fn()} />);
    expect(screen.getByText('Showing 1-10 of 50')).toBeInTheDocument();
  });

  it('highlights active page', () => {
    render(<Pagination total={50} limit={10} offset={20} onPageChange={vi.fn()} />);
    expect(screen.getByText('3 / 5')).toBeInTheDocument();
  });

  it('calls onPageChange when next page clicked', () => {
    const onPageChange = vi.fn();
    render(<Pagination total={50} limit={10} offset={0} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByTitle('Next page'));
    expect(onPageChange).toHaveBeenCalledWith(10);
  });

  it('calls onPageChange when previous page clicked', () => {
    const onPageChange = vi.fn();
    render(<Pagination total={50} limit={10} offset={20} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByTitle('Previous page'));
    expect(onPageChange).toHaveBeenCalledWith(10);
  });

  it('disables prev button on first page', () => {
    render(<Pagination total={50} limit={10} offset={0} onPageChange={vi.fn()} />);
    expect(screen.getByTitle('Previous page')).toBeDisabled();
    expect(screen.getByTitle('First page')).toBeDisabled();
  });

  it('disables next button on last page', () => {
    render(<Pagination total={50} limit={10} offset={40} onPageChange={vi.fn()} />);
    expect(screen.getByTitle('Next page')).toBeDisabled();
    expect(screen.getByTitle('Last page')).toBeDisabled();
  });

  it('calls onPageChange with first page offset when first page clicked', () => {
    const onPageChange = vi.fn();
    render(<Pagination total={50} limit={10} offset={30} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByTitle('First page'));
    expect(onPageChange).toHaveBeenCalledWith(0);
  });

  it('calls onPageChange with last page offset when last page clicked', () => {
    const onPageChange = vi.fn();
    render(<Pagination total={50} limit={10} offset={0} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByTitle('Last page'));
    expect(onPageChange).toHaveBeenCalledWith(40);
  });
});
