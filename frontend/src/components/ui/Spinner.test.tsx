import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Spinner, PageLoader } from './Spinner';

describe('Spinner', () => {
  it('renders spinner element', () => {
    const { container } = render(<Spinner />);
    const spinner = container.firstChild as HTMLElement;
    expect(spinner).toBeTruthy();
    expect(spinner.className).toContain('animate-spin');
  });

  it('applies sm size class', () => {
    const { container } = render(<Spinner size="sm" />);
    const spinner = container.firstChild as HTMLElement;
    expect(spinner.className).toContain('h-4');
    expect(spinner.className).toContain('w-4');
  });

  it('applies md size class by default', () => {
    const { container } = render(<Spinner />);
    const spinner = container.firstChild as HTMLElement;
    expect(spinner.className).toContain('h-6');
    expect(spinner.className).toContain('w-6');
  });

  it('applies lg size class', () => {
    const { container } = render(<Spinner size="lg" />);
    const spinner = container.firstChild as HTMLElement;
    expect(spinner.className).toContain('h-10');
    expect(spinner.className).toContain('w-10');
  });
});

describe('PageLoader', () => {
  it('renders a large spinner', () => {
    const { container } = render(<PageLoader />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
    expect(spinner!.className).toContain('h-10');
  });
});
