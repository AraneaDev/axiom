import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock useQuery to avoid network calls
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
}));

// Mock API modules
vi.mock('@/api/attachments.api', () => ({
  attachmentsApi: {
    getDownloadUrl: (id: string) => `/api/attachments/${id}/download`,
    convert: vi.fn(),
  },
}));

vi.mock('@/api/client', () => ({
  fetchWithAuth: vi.fn().mockResolvedValue({ ok: false }),
}));

vi.mock('@/lib/format', () => ({
  formatSize: (n: number) => `${n}B`,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  formatDate: () => '2024-01-01',
}));

// Import after mocks
import type { AttachmentMeta } from '@/api/attachments.api';

import { AttachmentList } from './AttachmentList';

const makeAttachment = (overrides: Partial<AttachmentMeta> = {}): AttachmentMeta => ({
  id: 'att-1',
  filename: 'document.txt',
  originalName: 'document.txt',
  mimeType: 'text/plain',
  size: 1024,
  storageKey: 'store/document.txt',
  uploaderId: 'user-1',
  issueId: null,
  pageId: null,
  commentId: null,
  createdAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

describe('AttachmentList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when attachments array is empty', () => {
    const { container } = render(<AttachmentList attachments={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders attachment file name', () => {
    const att = makeAttachment({ originalName: 'readme.txt' });
    render(<AttachmentList attachments={[att]} />);
    expect(screen.getByText('readme.txt')).toBeInTheDocument();
  });

  it('renders multiple attachments', () => {
    const atts = [
      makeAttachment({ id: 'att-1', originalName: 'file1.txt' }),
      makeAttachment({ id: 'att-2', originalName: 'file2.txt' }),
    ];
    render(<AttachmentList attachments={atts} />);
    expect(screen.getByText('file1.txt')).toBeInTheDocument();
    expect(screen.getByText('file2.txt')).toBeInTheDocument();
  });

  it('shows delete button when onDelete provided and currentUserId matches uploaderId', () => {
    const att = makeAttachment({ id: 'att-1', uploaderId: 'user-1' });
    const onDelete = vi.fn();
    render(<AttachmentList attachments={[att]} currentUserId="user-1" onDelete={onDelete} />);
    expect(screen.getByTitle('Delete attachment')).toBeInTheDocument();
  });

  it('does not show delete button when currentUserId does not match uploaderId', () => {
    const att = makeAttachment({ id: 'att-1', uploaderId: 'user-1' });
    const onDelete = vi.fn();
    render(<AttachmentList attachments={[att]} currentUserId="user-2" onDelete={onDelete} />);
    expect(screen.queryByTitle('Delete attachment')).not.toBeInTheDocument();
  });

  it('does not show delete button when onDelete is not provided', () => {
    const att = makeAttachment({ id: 'att-1', uploaderId: 'user-1' });
    render(<AttachmentList attachments={[att]} currentUserId="user-1" />);
    expect(screen.queryByTitle('Delete attachment')).not.toBeInTheDocument();
  });

  it('shows download button for each attachment', () => {
    const att = makeAttachment();
    render(<AttachmentList attachments={[att]} />);
    expect(screen.getByTitle('Download file')).toBeInTheDocument();
  });

  it('shows preview button for previewable mime types', () => {
    const att = makeAttachment({ mimeType: 'text/plain' });
    render(<AttachmentList attachments={[att]} />);
    expect(screen.getByTitle('Preview file')).toBeInTheDocument();
  });

  it('does not show preview button for non-previewable mime types', () => {
    const att = makeAttachment({ mimeType: 'application/octet-stream' });
    render(<AttachmentList attachments={[att]} />);
    expect(screen.queryByTitle('Preview file')).not.toBeInTheDocument();
  });

  it('clicking delete button opens confirm dialog', () => {
    const att = makeAttachment({
      id: 'att-1',
      uploaderId: 'user-1',
      originalName: 'delete-me.txt',
    });
    const onDelete = vi.fn();
    render(<AttachmentList attachments={[att]} currentUserId="user-1" onDelete={onDelete} />);
    const deleteBtn = screen.getByTitle('Delete attachment');
    fireEvent.click(deleteBtn);
    expect(screen.getByText('Delete Attachment')).toBeInTheDocument();
  });
});
