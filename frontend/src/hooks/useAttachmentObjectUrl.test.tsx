import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetBlob = vi.fn();
vi.mock('@/api/client', () => ({
  getBlob: (...args: unknown[]) => mockGetBlob(...args),
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
    mockGetBlob.mockReset();
    revoke.mockReset();
    counter = 0;
    URL.createObjectURL = vi.fn(() => `blob:test/${++counter}`);
    URL.revokeObjectURL = revoke;
  });

  it('fetches an attachment source with auth and returns a blob URL', async () => {
    mockGetBlob.mockResolvedValue(new Blob(['x']));
    const { result } = renderHook(() => useAttachmentObjectUrl('/api/attachments/abc123'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual({ url: null, error: false });
    await waitFor(() => expect(result.current.url).toBe('blob:test/1'));
    expect(mockGetBlob).toHaveBeenCalledWith('/api/attachments/abc123');
    expect(result.current.error).toBe(false);
  });

  it('passes other sources through without fetching', () => {
    const { result } = renderHook(() => useAttachmentObjectUrl('https://example.com/a.png'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual({ url: 'https://example.com/a.png', error: false });
    expect(mockGetBlob).not.toHaveBeenCalled();
  });

  it('reports an error when the fetch is refused', async () => {
    mockGetBlob.mockRejectedValue(new Error('404'));
    const { result } = renderHook(() => useAttachmentObjectUrl('/api/attachments/gone'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.url).toBeNull();
  });

  it('revokes the blob URL on unmount and fetches the same attachment once', async () => {
    mockGetBlob.mockResolvedValue(new Blob(['x']));
    const wrapper = makeWrapper();
    const first = renderHook(() => useAttachmentObjectUrl('/api/attachments/abc123'), { wrapper });
    const second = renderHook(() => useAttachmentObjectUrl('/api/attachments/abc123'), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.url).not.toBeNull());
    await waitFor(() => expect(second.result.current.url).not.toBeNull());
    expect(mockGetBlob).toHaveBeenCalledTimes(1);
    const url = first.result.current.url;
    const otherUrl = second.result.current.url;
    expect(otherUrl).not.toBe(url);
    first.unmount();
    expect(revoke).toHaveBeenCalledWith(url);
    expect(revoke).not.toHaveBeenCalledWith(otherUrl);
    expect(second.result.current.url).toBe(otherUrl);
  });

  it('revokes the previous blob URL when the source changes', async () => {
    mockGetBlob.mockResolvedValue(new Blob(['x']));
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
