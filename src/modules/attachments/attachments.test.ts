import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { prisma } from '../../config/database';

// Mock the storage module before importing app
const mockStorage = {
  put: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(Buffer.from('Hello, this is a test file.')),
  delete: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(true),
};

vi.mock('../../storage/storage', () => ({
  getStorage: () => mockStorage,
}));

const { default: app } = await import('../../index');

describe('Attachments API', () => {
  let token: string;
  let userId: string;
  let otherToken: string;
  let attachmentId: string;
  let pageId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);
    const user = await prisma.user.upsert({
      where: { username: 'attachuser' },
      update: {},
      create: {
        email: 'attachuser@axiom.dev',
        username: 'attachuser',
        displayName: 'Attach User',
        passwordHash,
      },
    });
    userId = user.id;

    await prisma.user.upsert({
      where: { username: 'attachother' },
      update: {},
      create: {
        email: 'attachother@axiom.dev',
        username: 'attachother',
        displayName: 'Other User',
        passwordHash,
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'attachuser', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    const otherLoginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'attachother', password: 'testpassword123' });
    otherToken = otherLoginRes.body.accessToken;

    // Create an org/team/space/page so we can associate attachments
    const org = await prisma.organization.create({
      data: {
        name: 'Attach Test Org',
        slug: 'attach-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    const team = await prisma.team.create({
      data: {
        name: 'Attach Test Team',
        slug: 'attach-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });
    const space = await prisma.wikiSpace.create({
      data: { teamId: team.id, name: 'Attach Space', slug: 'attach-space' },
    });
    const page = await prisma.page.create({
      data: { spaceId: space.id, title: 'Attach Page', slug: 'attach-page', body: '' },
    });
    pageId = page.id;
  });

  afterAll(async () => {
    await prisma.attachment.deleteMany({});
    await prisma.organization.deleteMany({ where: { slug: 'attach-test-org' } });
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({ where: { username: { in: ['attachuser', 'attachother'] } } });
    await prisma.$disconnect();
  });

  it('should upload a file with valid MIME type', async () => {
    const fileContent = Buffer.from('Hello, this is a test file.');

    const res = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .field('pageId', pageId)
      .attach('file', fileContent, { filename: 'test.txt', contentType: 'text/plain' });

    expect(res.status).toBe(201);
    expect(res.body.originalName).toBe('test.txt');
    expect(res.body.mimeType).toBe('text/plain');
    expect(res.body.uploaderId).toBe(userId);
    expect(mockStorage.put).toHaveBeenCalled();
    attachmentId = res.body.id;
  });

  it('should upload an image file', async () => {
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    const res = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .attach('file', pngBuffer, { filename: 'image.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.mimeType).toBe('image/png');
  });

  it('should reject a file with disallowed MIME type', async () => {
    const fileContent = Buffer.from('fake executable');

    const res = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .attach('file', fileContent, {
        filename: 'malware.exe',
        contentType: 'application/x-msdownload',
      });

    expect(res.status).toBe(415);
    expect(res.body.error.message).toContain('not allowed');
  });

  it('should reject upload with no file', async () => {
    const res = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(400);
  });

  it('should list attachments', async () => {
    const res = await request(app)
      .get(`/api/attachments?pageId=${pageId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('should get attachment metadata', async () => {
    const res = await request(app)
      .get(`/api/attachments/${attachmentId}/meta`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(attachmentId);
    expect(res.body.originalName).toBe('test.txt');
  });

  it('should download an attachment', async () => {
    const res = await request(app)
      .get(`/api/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(mockStorage.get).toHaveBeenCalled();
  });

  it('should return 404 for non-existent attachment', async () => {
    const res = await request(app)
      .get('/api/attachments/nonexistent-id/meta')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('should not allow another user to delete the attachment', async () => {
    const res = await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(403);
  });

  it('should delete an attachment', async () => {
    const res = await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(204);
    expect(mockStorage.delete).toHaveBeenCalled();
  });

  it('should return 404 after deletion', async () => {
    const res = await request(app)
      .get(`/api/attachments/${attachmentId}/meta`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
