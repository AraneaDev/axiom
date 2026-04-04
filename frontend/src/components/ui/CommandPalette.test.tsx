import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockToggleSearch = vi.fn();
const mockNavigate = vi.fn();

let mockSearchOpen = true;

vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/stores/ui.store', () => ({
  useUIStore: () => ({
    get searchOpen() {
      return mockSearchOpen;
    },
    toggleSearch: mockToggleSearch,
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
}));

vi.mock('@/api/search.api', () => ({
  searchApi: { search: vi.fn().mockResolvedValue([]) },
}));

// Import after mocks
import { CommandPalette } from './CommandPalette';

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchOpen = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the search input when open', () => {
    render(<CommandPalette />);
    expect(
      screen.getByPlaceholderText('Search issues, wiki, repos... (type:bug status:open)'),
    ).toBeInTheDocument();
  });

  it('renders the ESC keyboard shortcut hint', () => {
    render(<CommandPalette />);
    expect(screen.getByText('ESC')).toBeInTheDocument();
  });

  it('calls toggleSearch when backdrop is clicked', () => {
    render(<CommandPalette />);
    const backdrop = document.querySelector('.bg-backdrop');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(mockToggleSearch).toHaveBeenCalled();
  });

  it('calls toggleSearch when Escape key is pressed in input', () => {
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText(
      'Search issues, wiki, repos... (type:bug status:open)',
    );
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mockToggleSearch).toHaveBeenCalled();
  });

  it('updates query on input change', () => {
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText(
      'Search issues, wiki, repos... (type:bug status:open)',
    );
    fireEvent.change(input, { target: { value: 'test query' } });
    expect(input).toHaveValue('test query');
  });

  it('shows no results message after debounce', () => {
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText(
      'Search issues, wiki, repos... (type:bug status:open)',
    );
    fireEvent.change(input, { target: { value: 'nonexistent' } });

    // Before debounce, no message
    expect(screen.queryByText(/No results found/)).not.toBeInTheDocument();

    // Advance timers past the 300ms debounce
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.getByText(/No results found/)).toBeInTheDocument();
  });

  it('renders nothing when searchOpen is false', () => {
    mockSearchOpen = false;
    const { container } = render(<CommandPalette />);
    expect(container.innerHTML).toBe('');
  });
});
