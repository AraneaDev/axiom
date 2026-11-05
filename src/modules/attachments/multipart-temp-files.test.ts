/**
 * What supertest can't do: a client that goes away halfway through a body, or never ends it. Also
 * the cap on staged files. In a file of its own for the multipart rate limit of 10 per minute.
 */
import fs from 'fs';
import fsPromises from 'fs/promises';
import { createServer, type Server } from 'http';
import net, { type AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import v8 from 'v8';
import vm from 'vm';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { AppError } from '../../middleware/errorHandler';
import { LocalStorageBackend } from '../../storage/local';
import { createTestUser, type TestUser } from '../../test/factory';
import { authPost } from '../../test/helpers';
import { listenForRawRequests } from '../../test/raw-request';

import {
  MAX_CONCURRENT_SIGNED_PUTS,
  MAX_CONCURRENT_SIGNED_PUTS_PER_USER,
} from './attachments.routes';
import { MAX_STAGED_PER_USER, uploadAttachment } from './attachments.service';
import { newTempPath, receiveToTempFile, removeTempFile } from './temp-files';

process.env.STORAGE_PATH = path.join(os.tmpdir(), `axiom-temp-test-${process.pid}`);

const TEMP_DIR = '/tmp/uploads';
const BOUNDARY = 'testboundary';

// Under load everything here takes longer, and these tests are about what happens, not how fast
vi.setConfig({ testTimeout: 120_000 });
const settled = (assertion: () => void | Promise<void>) =>
  vi.waitFor(assertion, { timeout: 60_000, interval: 50 });

/** A garbage collection now: garbage is load, what's left is what the code holds on to. */
function collectGarbage() {
  v8.setFlagsFromString('--expose-gc');
  (vm.runInNewContext('gc') as () => void)();
}

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

const openStoredStreams = () =>
  fs
    .readdirSync('/proc/self/fd')
    .map((fd) => {
      try {
        return fs.readlinkSync(`/proc/self/fd/${fd}`);
      } catch {
        return '';
      }
    })
    .filter((target) => target.includes('stream/a.txt'));

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
    await settled(() => expect(tempFiles().length).toBeGreaterThan(before.length));

    socket.destroy();

    await settled(() => {
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
    await settled(() => {
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

  it('gives up on a body that takes too long, and removes what it had', async () => {
    const before = tempFiles();
    const refusal = (statusCode: number) => new AppError(statusCode, 'refused');
    const reader = createServer((req, res) => {
      receiveToTempFile(req, {
        limit: 100,
        timeoutMs: 50,
        tooLarge: refusal(413),
        empty: refusal(400),
        interrupted: refusal(400),
        timedOut: refusal(408),
      }).then(
        () => res.writeHead(200).end(),
        (err: AppError) => res.writeHead(err.statusCode).end(),
      );
    });
    await new Promise<void>((resolve) => reader.listen(0, '127.0.0.1', resolve));
    const socket = net.connect((reader.address() as AddressInfo).port, '127.0.0.1');
    socket.write('PUT / HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\nx');
    const head = await responseHead(socket);
    expect(head).toContain('408');
    await settled(() => expect(tempFiles()).toEqual(before));
    socket.destroy();
    reader.closeAllConnections();
    reader.close();
  });

  it('answers at once when the client left before its body was read', async () => {
    const source = new PassThrough();
    source.destroy();
    const started = Date.now();
    await expect(
      receiveToTempFile(source, {
        limit: 100,
        timeoutMs: 60_000,
        tooLarge: new AppError(413, 'x'),
        empty: new AppError(400, 'x'),
        interrupted: new AppError(400, 'gone'),
        timedOut: new AppError(408, 'x'),
      }),
    ).rejects.toMatchObject({ message: 'gone' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('removes the temp file of a signed upload the client aborts', async () => {
    const before = tempFiles();
    const url = await signedUrl(1024 * 1024);
    const socket = await connect(
      `PUT ${url} HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\n` +
        `Content-Length: ${1024 * 1024}\r\n\r\npartial`,
    );
    await settled(() => expect(tempFiles().length).toBeGreaterThan(before.length));
    socket.destroy();
    await settled(() => {
      expect(tempFiles()).toEqual(before);
      expect(openTempStreams()).toEqual([]);
    });
  });

  it('caps the signed uploads a user has running', async () => {
    const urls = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_SIGNED_PUTS_PER_USER + 1 }, () => signedUrl(1024)),
    );
    const before = tempFiles();
    const held = await Promise.all(
      urls
        .slice(1)
        .map((url) =>
          connect(
            `PUT ${url} HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\n` +
              'Content-Length: 1024\r\n\r\nx',
          ),
        ),
    );
    await settled(() => expect(tempFiles().length).toBe(before.length + held.length));

    const put = () => request(app).put(urls[0]).set('Content-Type', 'text/plain').send('x');
    const refused = await put();
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('RATE_LIMITED');

    for (const socket of held) socket.destroy();
    await settled(() => expect(tempFiles()).toEqual(before));
    // Neither the refusal nor the aborts used anything up
    await settled(async () => expect((await put()).status).toBe(201));
  });

  it('keeps memory flat with many large bodies held open', async () => {
    const USERS = 5;
    const BODY = Buffer.alloc(10 * 1024 * 1024, 65);
    const users = await Promise.all(Array.from({ length: USERS }, () => createTestUser()));
    const urls: string[] = [];
    for (const held of users) {
      for (let i = 0; i < MAX_CONCURRENT_SIGNED_PUTS_PER_USER; i++) {
        const res = await authPost('/api/attachments/upload-url', held.token, {
          filename: 'big.txt',
          mimeType: 'text/plain',
          size: 25 * 1024 * 1024,
        });
        expect(res.status).toBe(201);
        urls.push(res.body.uploadUrl as string);
      }
    }
    const before = tempFiles();
    collectGarbage();
    const startMemory = process.memoryUsage();
    const sockets = await Promise.all(
      urls.map(async (url) => {
        const socket = await connect(
          `PUT ${url} HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\n` +
            `Content-Length: ${25 * 1024 * 1024}\r\n\r\n`,
        );
        socket.write(BODY);
        return socket;
      }),
    );
    const onDisk = () =>
      tempFiles()
        .filter((name) => !before.includes(name))
        .reduce((sum, name) => sum + fs.statSync(path.join(TEMP_DIR, name)).size, 0);
    // All of it has arrived, and it is on disk
    await settled(() => expect(onDisk()).toBe(urls.length * BODY.length));
    collectGarbage();
    const endMemory = process.memoryUsage();
    // 200 MB is held open. In memory it would all show up in arrayBuffers, and the stream chunks
    // on their way through are all that may. The client's one shared buffer is counted before.
    const grown = endMemory.arrayBuffers - startMemory.arrayBuffers;
    expect(grown).toBeLessThan(64 * 1024 * 1024);

    for (const socket of sockets) socket.destroy();
    await settled(() => expect(tempFiles()).toEqual(before));
    await prisma.user.deleteMany({ where: { id: { in: users.map((held) => held.id) } } });
  });

  it('stores a multipart file of exactly 25 MB', async () => {
    const before = tempFiles();
    const res = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${user.token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .attach('file', Buffer.alloc(25 * 1024 * 1024, 1), {
        filename: 'n.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(201);
    expect(res.body.size).toBe(25 * 1024 * 1024);
    await settled(() => expect(tempFiles()).toEqual(before));
  });

  it('caps a multipart file name at 255 characters', async () => {
    const before = tempFiles();
    const named = (filename: string) =>
      request(app)
        .post('/api/attachments')
        .set('Authorization', `Bearer ${user.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .attach('file', Buffer.from('x'), { filename, contentType: 'text/plain' });
    const atCap = await named(`${'n'.repeat(251)}.txt`);
    expect(atCap.status).toBe(201);
    expect(atCap.body.originalName).toHaveLength(255);
    const over = await named(`${'n'.repeat(252)}.txt`);
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('BAD_UPLOAD');
    await settled(() => expect(tempFiles()).toEqual(before));
  });

  it('caps the signed uploads running over all users, with Retry-After', async () => {
    const perUser = MAX_CONCURRENT_SIGNED_PUTS_PER_USER;
    const users = await Promise.all(
      Array.from({ length: Math.ceil(MAX_CONCURRENT_SIGNED_PUTS / perUser) + 1 }, () =>
        createTestUser(),
      ),
    );
    const urlFor = async (holder: TestUser) => {
      const res = await authPost('/api/attachments/upload-url', holder.token, {
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 1024,
      });
      expect(res.status).toBe(201);
      return res.body.uploadUrl as string;
    };
    const urls: string[] = [];
    for (const holder of users.slice(0, -1)) {
      for (let i = 0; i < perUser; i++) urls.push(await urlFor(holder));
    }
    const lastUrl = await urlFor(users[users.length - 1]);
    const before = tempFiles();
    const held = await Promise.all(
      urls.map((url) =>
        connect(
          `PUT ${url} HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\n` +
            'Content-Length: 1024\r\n\r\nx',
        ),
      ),
    );
    await settled(() =>
      expect(tempFiles().length).toBe(before.length + MAX_CONCURRENT_SIGNED_PUTS),
    );

    const put = () => request(app).put(lastUrl).set('Content-Type', 'text/plain').send('x');
    const refused = await put();
    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toBe('30');

    for (const socket of held) socket.destroy();
    await settled(() => expect(tempFiles()).toEqual(before));
    await settled(async () => expect((await put()).status).toBe(201));
    await prisma.user.deleteMany({ where: { id: { in: users.map((holder) => holder.id) } } });
  });

  it('moves and deletes nothing outside the temp directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-outside-'));
    const outside = path.join(dir, 'keep.txt');
    fs.writeFileSync(outside, 'keep');
    const sneaky = path.join(TEMP_DIR, '..', path.basename(dir), 'keep.txt');
    const nested = path.join(TEMP_DIR, 'sub', 'keep.txt');
    const storage = new LocalStorageBackend();

    await expect(storage.putFile('stolen.txt', outside, 'text/plain')).rejects.toThrow('temp');
    await expect(storage.putFile('stolen.txt', sneaky, 'text/plain')).rejects.toThrow('temp');
    await expect(storage.putFile('stolen.txt', nested, 'text/plain')).rejects.toThrow('temp');
    await expect(storage.exists('stolen.txt')).resolves.toBe(false);

    await removeTempFile(outside);
    await removeTempFile(sneaky);
    expect(fs.existsSync(outside)).toBe(true);

    const rows = await prisma.attachment.count();
    await expect(
      uploadAttachment(
        { originalname: 'a.txt', mimetype: 'text/plain', size: 4, path: outside },
        user.id,
        {},
      ),
    ).rejects.toThrow('temp');
    expect(fs.existsSync(outside)).toBe(true);
    expect(await prisma.attachment.count()).toBe(rows);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('opens a stored file as a stream with its size, and rejects a missing one', async () => {
    const storage = new LocalStorageBackend();
    await storage.put('stream/a.txt', Buffer.from('in pieces'), 'text/plain');
    const { stream, size } = await storage.openStream('stream/a.txt');
    expect(size).toBe(9);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('in pieces');
    await expect(storage.openStream('stream/none.txt')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(openStoredStreams()).toEqual([]);
  });

  it('moves a file into storage, or copies it across filesystems', async () => {
    const storage = new LocalStorageBackend();
    const write = () => {
      const tempPath = newTempPath();
      fs.writeFileSync(tempPath, 'on disk');
      return tempPath;
    };
    const moved = write();
    await storage.putFile('putfile/moved.txt', moved, 'text/plain');
    expect(fs.existsSync(moved)).toBe(false);
    expect((await storage.get('putfile/moved.txt')).toString()).toBe('on disk');

    const copied = write();
    const crossDevice = Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
    const rename = vi.spyOn(fsPromises, 'rename').mockRejectedValueOnce(crossDevice);
    await storage.putFile('putfile/copied.txt', copied, 'text/plain');
    rename.mockRestore();
    expect(fs.existsSync(copied)).toBe(false);
    expect((await storage.get('putfile/copied.txt')).toString()).toBe('on disk');
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
    await settled(() => expect(tempFiles()).toEqual(before));

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
