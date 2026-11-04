/**
 * What supertest can't do: a client that goes away halfway through a body, or never ends it. Also
 * the cap on staged files. In a file of its own for the multipart rate limit of 10 per minute.
 */
import fs from 'fs';
import { createServer, type Server } from 'http';
import net, { type AddressInfo } from 'net';
import os from 'os';
import path from 'path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { createTestUser, type TestUser } from '../../test/factory';
import { authPost } from '../../test/helpers';
import { listenForRawRequests } from '../../test/raw-request';

import { readLimitedBody } from './attachments.routes';
import { MAX_STAGED_PER_USER } from './attachments.service';

process.env.STORAGE_PATH = path.join(os.tmpdir(), `axiom-temp-test-${process.pid}`);

const TEMP_DIR = '/tmp/uploads';
const BOUNDARY = 'testboundary';

const tempFiles = () => fs.readdirSync(TEMP_DIR).sort();
const openTempStreams = () =>
  fs
    .readdirSync('/proc/self/fd')
    .map((fd) => {
      try {
        return fs.readlinkSync(`/proc/self/fd/${fd}`);
      } catch {
        return '';
      }
    })
    .filter((target) => target.startsWith(TEMP_DIR));

const partHead =
  `--${BOUNDARY}\r\n` +
  'Content-Disposition: form-data; name="file"; filename="n.txt"\r\n' +
  'Content-Type: text/plain\r\n\r\n';

describe('requests that do not finish', () => {
  let server: Server;
  let user: TestUser;

  /**
   * Open a connection and send the head of a request.
   * @param head
   */
  const connect = (head: string) =>
    new Promise<net.Socket>((resolve) => {
      const socket = net.connect((server.address() as AddressInfo).port, '127.0.0.1', () => {
        socket.write(head);
        resolve(socket);
      });
      socket.on('error', () => {});
    });

  /**
   * Everything the server sends until it has sent a complete head.
   * @param socket
   */
  const responseHead = (socket: net.Socket) =>
    new Promise<string>((resolve) => {
      let text = '';
      socket.on('data', (chunk: Buffer) => {
        text += chunk.toString();
        if (text.includes('\r\n\r\n')) resolve(text);
      });
    });

  const multipartHead = (contentLength: number) =>
    'POST /api/attachments HTTP/1.1\r\nHost: x\r\n' +
    `Authorization: Bearer ${user.token}\r\nX-Requested-With: XMLHttpRequest\r\n` +
    `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n` +
    `Content-Length: ${contentLength}\r\n\r\n`;

  const signedUrl = async (size: number) => {
    const res = await authPost('/api/attachments/upload-url', user.token, {
      filename: 'a.txt',
      mimeType: 'text/plain',
      size,
    });
    expect(res.status).toBe(201);
    return res.body.uploadUrl as string;
  };

  beforeAll(async () => {
    server = await listenForRawRequests(app);
    user = await createTestUser();
  });

  afterAll(async () => {
    server.closeAllConnections();
    server.close();
    await prisma.user.deleteMany({ where: { id: user.id } });
    fs.rmSync(process.env.STORAGE_PATH as string, { recursive: true, force: true });
  });

  it('removes the temp file of an upload the client aborts', async () => {
    const before = tempFiles();
    const socket = await connect(multipartHead(10 * 1024 * 1024) + partHead);
    socket.write(Buffer.alloc(150 * 1024, 65));
    await vi.waitFor(() => expect(tempFiles().length).toBeGreaterThan(before.length));

    socket.destroy();

    await vi.waitFor(() => {
      expect(tempFiles()).toEqual(before);
      expect(openTempStreams()).toEqual([]);
    });
  });

  it('removes the temp file of a body without a closing boundary', async () => {
    const before = tempFiles();
    const body = `${partHead}partial`;
    const socket = await connect(multipartHead(Buffer.byteLength(body)) + body);
    const head = await responseHead(socket);
    expect(head).toContain('400');
    await vi.waitFor(() => {
      expect(tempFiles()).toEqual(before);
      expect(openTempStreams()).toEqual([]);
    });
    socket.destroy();
  });

  it('answers 413 for a declared length over the limit without waiting for the body', async () => {
    const url = await signedUrl(10);
    const socket = await connect(
      `PUT ${url} HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\n` +
        'Content-Length: 1000000\r\n\r\n',
    );
    expect(await responseHead(socket)).toContain('413');
    socket.destroy();
  });

  it('answers 413 for a chunked body over the limit that never ends', async () => {
    const url = await signedUrl(10);
    const socket = await connect(
      `PUT ${url} HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\n` +
        'Transfer-Encoding: chunked\r\n\r\n',
    );
    socket.write(`14\r\n${'x'.repeat(20)}\r\n`);
    const head = await responseHead(socket);
    expect(head).toContain('413');
    expect(head.toLowerCase()).toContain('connection: close');
    socket.destroy();
  });

  it('does not use up the URL when the client aborts its body', async () => {
    const url = await signedUrl(100);
    const socket = await connect(
      `PUT ${url} HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\n` +
        'Content-Length: 100\r\n\r\npartial',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const res = await request(app).put(url).set('Content-Type', 'text/plain').send('whole');
    expect(res.status).toBe(201);
  });

  it('gives up on a body that takes too long', async () => {
    const reader = createServer((req, res) => {
      readLimitedBody(req as never, 100, 50).then(
        () => res.writeHead(200).end(),
        (err: { statusCode: number }) => res.writeHead(err.statusCode).end(),
      );
    });
    await new Promise<void>((resolve) => reader.listen(0, '127.0.0.1', resolve));
    const socket = net.connect((reader.address() as AddressInfo).port, '127.0.0.1');
    socket.write('PUT / HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\nx');
    const head = await responseHead(socket);
    expect(head).toContain('408');
    socket.destroy();
    reader.closeAllConnections();
    reader.close();
  });

  it('caps the staged files of a user, on every way in', async () => {
    const full = await createTestUser();
    const auth = `Bearer ${full.token}`;
    const csrf = { 'X-Requested-With': 'XMLHttpRequest' };
    const file = { filename: 'a.txt', mimeType: 'text/plain', size: 10 };
    const made = await authPost('/api/attachments/upload-url', full.token, file);
    expect(made.status).toBe(201);

    await prisma.attachment.createMany({
      data: Array.from({ length: MAX_STAGED_PER_USER }, (_, i) => ({
        filename: `f${i}`,
        originalName: `f${i}`,
        mimeType: 'text/plain',
        size: 1,
        storageKey: `none/${i}`,
        uploaderId: full.id,
        stagedAt: new Date(),
      })),
    });
    const before = tempFiles();

    const url = await authPost('/api/attachments/upload-url', full.token, file);
    expect(url.status).toBe(429);
    expect(url.body.error.code).toBe('STAGED_LIMIT');

    const put = await request(app)
      .put(made.body.uploadUrl)
      .set('Content-Type', 'text/plain')
      .send('x');
    expect(put.status).toBe(429);

    const multipart = await request(app)
      .post('/api/attachments')
      .set('Authorization', auth)
      .set(csrf)
      .attach('file', Buffer.from('x'), 'n.txt');
    expect(multipart.status).toBe(429);
    expect(tempFiles()).toEqual(before);

    const fetched = await authPost('/api/attachments/from-url', full.token, {
      url: 'https://example.com/a.png',
    });
    expect(fetched.status).toBe(429);

    // The PUT did not use up its URL: with room again it works
    await prisma.attachment.deleteMany({ where: { uploaderId: full.id } });
    const retried = await request(app)
      .put(made.body.uploadUrl)
      .set('Content-Type', 'text/plain')
      .send('x');
    expect(retried.status).toBe(201);
    await prisma.user.delete({ where: { id: full.id } });
  });
});
