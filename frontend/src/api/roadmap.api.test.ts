import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock('./client', () => client);

import { roadmapApi } from './roadmap.api';

beforeEach(() => {
  vi.clearAllMocks();
  client.get.mockResolvedValue({});
  client.post.mockResolvedValue({});
});

describe('roadmapApi.buildQuery', () => {
  it('is empty without filters and skips empty values', () => {
    expect(roadmapApi.buildQuery()).toBe('');
    expect(roadmapApi.buildQuery({ q: '', type: undefined })).toBe('');
  });

  it('encodes the filters that are set', () => {
    expect(roadmapApi.buildQuery({ type: 'Bug', q: 'a b' })).toBe('?type=Bug&q=a+b');
  });
});

describe('roadmapApi routes', () => {
  it('reads the project timeline and bucket view with the filters', async () => {
    await roadmapApi.getTimeline('p1', { priority: 'High' });
    expect(client.get).toHaveBeenCalledWith('/projects/p1/roadmap/timeline?priority=High');
    await roadmapApi.getBucketsView('p1');
    expect(client.get).toHaveBeenCalledWith('/projects/p1/roadmap/buckets-view');
  });

  it('reads the team timeline with its filters', async () => {
    await roadmapApi.getTeamTimeline('t1', { projectId: 'p2', search: 'x' });
    expect(client.get).toHaveBeenCalledWith('/teams/t1/roadmap/timeline?projectId=p2&search=x');
  });

  it('sends the reorder as bucketIds', async () => {
    await roadmapApi.reorderBuckets('p1', ['b2', 'b1']);
    expect(client.post).toHaveBeenCalledWith('/projects/p1/roadmap/buckets/reorder', {
      bucketIds: ['b2', 'b1'],
    });
  });

  it('manages buckets on the bucket routes', async () => {
    await roadmapApi.listBuckets('p1');
    expect(client.get).toHaveBeenCalledWith('/projects/p1/roadmap/buckets');
    await roadmapApi.createBucket('p1', { name: 'Now' });
    expect(client.post).toHaveBeenCalledWith('/projects/p1/roadmap/buckets', { name: 'Now' });
    await roadmapApi.createDefaults('p1');
    expect(client.post).toHaveBeenCalledWith('/projects/p1/roadmap/buckets/defaults', {});
    await roadmapApi.updateBucket('p1', 'b1', { name: 'Next' });
    expect(client.patch).toHaveBeenCalledWith('/projects/p1/roadmap/buckets/b1', { name: 'Next' });
    await roadmapApi.deleteBucket('p1', 'b1');
    expect(client.del).toHaveBeenCalledWith('/projects/p1/roadmap/buckets/b1');
  });
});
