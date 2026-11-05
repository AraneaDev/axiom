import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Declare mock state via vi.hoisted so it's available when vi.mock factories run
const queryState = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: true,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: queryState.data, isLoading: queryState.isLoading }),
}));

vi.mock('@/api/attachments.api', () => ({
  attachmentsApi: {
    getDownloadUrl: (id: string) => `/api/attachments/${id}/download`,
    convert: vi.fn(),
  },
}));

vi.mock('@/api/client', () => ({
  getBlob: vi.fn().mockRejectedValue(new Error('no file')),
}));

vi.mock('@/lib/format', () => ({
  formatSize: (n: number) => `${n}B`,
}));

// Import after mocks
import type { AttachmentMeta } from '@/api/attachments.api';

import { AttachmentPreview } from './AttachmentPreview';

const makeAttachment = (overrides: Partial<AttachmentMeta> = {}): AttachmentMeta => ({
  id: 'att-1',
  filename: 'file.txt',
  originalName: 'file.txt',
  mimeType: 'text/plain',
  size: 512,
  uploaderId: 'user-1',
  issueId: null,
  pageId: null,
  commentId: null,
  createdAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

describe('AttachmentPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.data = undefined;
    queryState.isLoading = true;
  });

  it('renders nothing when attachment is null', () => {
    const { container } = render(
      <AttachmentPreview attachment={null} open={true} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when open is false and attachment is null', () => {
    const { container } = render(
      <AttachmentPreview attachment={null} open={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders modal with attachment name as title', () => {
    const att = makeAttachment({ originalName: 'myfile.txt', mimeType: 'text/plain' });
    render(<AttachmentPreview attachment={att} open={true} onClose={vi.fn()} />);
    expect(screen.getByText('myfile.txt')).toBeInTheDocument();
  });

  it('renders loading spinner while image is loading (no img tag)', () => {
    queryState.data = undefined;
    queryState.isLoading = true;
    const att = makeAttachment({ mimeType: 'image/png', originalName: 'photo.png' });
    const { container } = render(
      <AttachmentPreview attachment={att} open={true} onClose={vi.fn()} />,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders img tag when image blob is ready', () => {
    queryState.data = 'blob:mock-url';
    queryState.isLoading = false;
    const att = makeAttachment({ mimeType: 'image/png', originalName: 'photo.png' });
    render(<AttachmentPreview attachment={att} open={true} onClose={vi.fn()} />);
    // Modal uses createPortal into document.body, so query from there
    const img = document.body.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('blob:mock-url');
    expect(img?.getAttribute('alt')).toBe('photo.png');
  });

  it('renders iframe for PDF when blob is ready', () => {
    queryState.data = 'blob:pdf-url';
    queryState.isLoading = false;
    const att = makeAttachment({ mimeType: 'application/pdf', originalName: 'doc.pdf' });
    render(<AttachmentPreview attachment={att} open={true} onClose={vi.fn()} />);
    const iframe = document.body.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute('src')).toBe('blob:pdf-url');
  });

  it('renders pre element for text when content is ready', () => {
    queryState.data = 'hello world';
    queryState.isLoading = false;
    const att = makeAttachment({ mimeType: 'text/plain', originalName: 'readme.txt' });
    render(<AttachmentPreview attachment={att} open={true} onClose={vi.fn()} />);
    const pre = document.body.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toBe('hello world');
  });

  it('renders unsupported message for unknown mime type', () => {
    const att = makeAttachment({
      mimeType: 'application/octet-stream',
      originalName: 'binary.bin',
    });
    render(<AttachmentPreview attachment={att} open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Preview is not available for this file type.')).toBeInTheDocument();
    // Filename appears in both modal title and unsupported body
    expect(screen.getAllByText('binary.bin').length).toBeGreaterThanOrEqual(1);
  });

  it('renders Download button in footer', () => {
    const att = makeAttachment({ mimeType: 'text/plain' });
    render(<AttachmentPreview attachment={att} open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Download')).toBeInTheDocument();
  });

  it('renders Close button in footer', () => {
    const att = makeAttachment({ mimeType: 'text/plain' });
    render(<AttachmentPreview attachment={att} open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  it('renders Download as Markdown button for convertible mime types', () => {
    const att = makeAttachment({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      originalName: 'doc.docx',
    });
    render(<AttachmentPreview attachment={att} open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Download as Markdown')).toBeInTheDocument();
  });

  it('does not render Download as Markdown for non-convertible mime types', () => {
    const att = makeAttachment({ mimeType: 'image/png', originalName: 'photo.png' });
    render(<AttachmentPreview attachment={att} open={true} onClose={vi.fn()} />);
    expect(screen.queryByText('Download as Markdown')).not.toBeInTheDocument();
  });
});
