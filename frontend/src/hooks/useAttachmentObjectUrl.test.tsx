import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchWithAuth = vi.fn();
vi.mock('@/api/client', () => ({
  fetchWithAuth: (...args: unknown[]) => mockFetchWithAuth(...args),
}));

import { useAttachmentObjectUrl } from './useAttachmentObjectUrl';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('useAttachmentObjectUrl', () => {
  let counter = 0;
  const revoke = vi.fn();

  beforeEach(() => {
    mockFetchWithAuth.mockReset();
    revoke.mockReset();
    counter = 0;
    URL.createObjectURL = vi.fn(() => `blob:test/${++counter}`);
    URL.revokeObjectURL = revoke;
  });

  it('fetches an attachment source with auth and returns a blob URL', async () => {
    mockFetchWithAuth.mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) });
    const { result } = renderHook(() => useAttachmentObjectUrl('/api/attachments/abc123'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual({ url: null, error: false });
    await waitFor(() => expect(result.current.url).toBe('blob:test/1'));
    expect(mockFetchWithAuth).toHaveBeenCalledWith('/api/attachments/abc123');
    expect(result.current.error).toBe(false);
  });

  it('passes other sources through without fetching', () => {
    const { result } = renderHook(() => useAttachmentObjectUrl('https://example.com/a.png'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual({ url: 'https://example.com/a.png', error: false });
    expect(mockFetchWithAuth).not.toHaveBeenCalled();
  });

  it('reports an error when the fetch is refused', async () => {
    mockFetchWithAuth.mockResolvedValue({ ok: false, status: 404 });
    const { result } = renderHook(() => useAttachmentObjectUrl('/api/attachments/gone'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.url).toBeNull();
  });

  it('revokes the blob URL on unmount and fetches the same attachment once', async () => {
    mockFetchWithAuth.mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) });
    const wrapper = makeWrapper();
    const first = renderHook(() => useAttachmentObjectUrl('/api/attachments/abc123'), { wrapper });
    const second = renderHook(() => useAttachmentObjectUrl('/api/attachments/abc123'), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.url).not.toBeNull());
    await waitFor(() => expect(second.result.current.url).not.toBeNull());
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
    const url = first.result.current.url;
    first.unmount();
    expect(revoke).toHaveBeenCalledWith(url);
  });

  it('revokes the previous blob URL when the source changes', async () => {
    mockFetchWithAuth.mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) });
    const { result, rerender } = renderHook(({ src }) => useAttachmentObjectUrl(src), {
      wrapper: makeWrapper(),
      initialProps: { src: '/api/attachments/one' },
    });
    await waitFor(() => expect(result.current.url).toBe('blob:test/1'));
    rerender({ src: 'https://example.com/b.png' });
    expect(revoke).toHaveBeenCalledWith('blob:test/1');
    expect(result.current.url).toBe('https://example.com/b.png');
  });
});
