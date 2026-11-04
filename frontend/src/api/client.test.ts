import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  const fn = vi.fn();
  vi.stubGlobal('fetch', fn);
  return fn;
});

import { getBlob, setTokens } from './client';

const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

describe('getBlob', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    setTokens('old-access', 'refresh');
  });

  it('returns the file', async () => {
    const blob = new Blob(['x']);
    fetchMock.mockResolvedValue({ ok: true, status: 200, blob: async () => blob } as Response);
    expect(await getBlob('/api/attachments/a')).toBe(blob);
  });

  it('refreshes an expired token once and retries with the new one', async () => {
    const blob = new Blob(['x']);
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
      .mockResolvedValueOnce(json(200, { accessToken: 'new-access', refreshToken: 'refresh2' }))
      .mockResolvedValueOnce({ ok: true, status: 200, blob: async () => blob } as Response);
    expect(await getBlob('/api/attachments/a')).toBe(blob);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh');
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer new-access');
  });

  it('throws an error carrying the status, which the query retry predicate reads', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as Response);
    await expect(getBlob('/api/attachments/a')).rejects.toMatchObject({ status: 404 });
  });
});
