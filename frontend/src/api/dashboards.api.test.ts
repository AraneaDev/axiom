import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  put: vi.fn(),
}));
vi.mock('./client', () => client);

import { dashboardsApi } from './dashboards.api';

const block = (title: string) => ({ widgets: [{ id: 'w', type: 'COUNT', title }], projectIds: [] });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dashboardsApi.renderEmbedded', () => {
  it('sends the blocks of one page asked in the same moment as one request', async () => {
    client.post.mockResolvedValue({
      blocks: [
        { embedId: 'a', block: block('A') },
        { embedId: 'b', block: block('B') },
        { embedId: 'c', block: block('C') },
      ],
    });
    const [a, b, c] = await Promise.all([
      dashboardsApi.renderEmbedded('page1', 'a'),
      dashboardsApi.renderEmbedded('page1', 'b'),
      dashboardsApi.renderEmbedded('page1', 'c'),
    ]);
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(client.post).toHaveBeenCalledWith('/dashboards/embedded/batch', {
      pageId: 'page1',
      embedIds: ['a', 'b', 'c'],
    });
    expect([a.widgets[0].title, b.widgets[0].title, c.widgets[0].title]).toEqual(['A', 'B', 'C']);
  });

  it('asks the same block twice with one embedId and gives both the answer', async () => {
    client.post.mockResolvedValue({ blocks: [{ embedId: 'a', block: block('A') }] });
    const [first, second] = await Promise.all([
      dashboardsApi.renderEmbedded('page1', 'a'),
      dashboardsApi.renderEmbedded('page1', 'a'),
    ]);
    expect(client.post.mock.calls[0][1]).toEqual({ pageId: 'page1', embedIds: ['a'] });
    expect(first).toEqual(second);
  });

  it('keeps pages apart: one request per page', async () => {
    client.post.mockImplementation((_path: string, body: { embedIds: string[] }) =>
      Promise.resolve({
        blocks: body.embedIds.map((embedId) => ({ embedId, block: block(embedId) })),
      }),
    );
    await Promise.all([
      dashboardsApi.renderEmbedded('page1', 'a'),
      dashboardsApi.renderEmbedded('page2', 'a'),
    ]);
    expect(client.post).toHaveBeenCalledTimes(2);
  });

  it('fails a block alone, with its status, and leaves the others be', async () => {
    client.post.mockResolvedValue({
      blocks: [
        { embedId: 'a', block: block('A') },
        { embedId: 'gone', error: { status: 404, code: 'NOT_FOUND', message: 'Gone' } },
      ],
    });
    const [ok, failed] = await Promise.allSettled([
      dashboardsApi.renderEmbedded('page1', 'a'),
      dashboardsApi.renderEmbedded('page1', 'gone'),
    ]);
    expect(ok.status).toBe('fulfilled');
    expect(failed.status).toBe('rejected');
    const reason = (failed as PromiseRejectedResult).reason as Error & { status?: number };
    expect(reason.message).toBe('Gone');
    expect(reason.status).toBe(404);
  });

  it('rejects every block of the batch when the request itself fails', async () => {
    const refused = Object.assign(new Error('Too many'), { status: 429 });
    client.post.mockRejectedValue(refused);
    const results = await Promise.allSettled([
      dashboardsApi.renderEmbedded('page1', 'a'),
      dashboardsApi.renderEmbedded('page1', 'b'),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect((results[0] as PromiseRejectedResult).reason).toBe(refused);
  });

  it('splits a page of more than 50 blocks over requests of at most 50', async () => {
    client.post.mockImplementation((_path: string, body: { embedIds: string[] }) =>
      Promise.resolve({
        blocks: body.embedIds.map((embedId) => ({ embedId, block: block(embedId) })),
      }),
    );
    const ids = Array.from({ length: 51 }, (_, i) => `b${i}`);
    await Promise.all(ids.map((id) => dashboardsApi.renderEmbedded('page1', id)));
    expect(client.post.mock.calls.map((call) => call[1].embedIds.length).sort()).toEqual([1, 50]);
  });

  it('asks again later for a block asked again, in a new request', async () => {
    client.post.mockResolvedValue({ blocks: [{ embedId: 'a', block: block('A') }] });
    await dashboardsApi.renderEmbedded('page1', 'a');
    await dashboardsApi.renderEmbedded('page1', 'a');
    expect(client.post).toHaveBeenCalledTimes(2);
  });
});
