/**
 * MCP message routing: a POST may only reach the SSE session of the user who sent it.
 */
import { Server } from 'http';
import { AddressInfo } from 'net';

import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import { authenticate } from '../middleware/auth';
import { createTestUser, type TestUser } from '../test/factory';

import { handleMcpMessage, handleMcpSse } from './server';

describe('MCP message sessions', () => {
  let server: Server;
  let base: string;
  let alice: TestUser;
  let mallory: TestUser;
  const aborts: AbortController[] = [];

  /**
   * Open an SSE session as the user and return its message endpoint.
   * @param user
   */
  async function openSession(user: TestUser): Promise<string> {
    const abort = new AbortController();
    aborts.push(abort);
    const res = await fetch(`${base}/api/mcp`, {
      headers: { Authorization: `Bearer ${user.token}` },
      signal: abort.signal,
    });
    const reader = res.body!.getReader();
    let text = '';
    while (!/data: (\S+)/.test(text)) {
      const { value, done } = await reader.read();
      if (done) throw new Error('SSE stream ended before the endpoint event');
      text += new TextDecoder().decode(value);
    }
    return /data: (\S+)/.exec(text)![1];
  }

  const post = (path: string, user: TestUser) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });

  beforeAll(async () => {
    alice = await createTestUser();
    mallory = await createTestUser();
    // The routes as src/index.ts mounts them (its lazy require of the SDK is a no-op in tests)
    const app = express();
    app.get('/api/mcp', authenticate, handleMcpSse);
    app.post('/api/mcp/messages', authenticate, handleMcpMessage);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const a of aborts) a.abort();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, mallory.id] } } });
  });

  it('refuses a message without a session', async () => {
    await openSession(alice);
    const res = await post('/api/mcp/messages', mallory);
    expect(res.status).toBe(400);
  });

  it("refuses a message to another user's session", async () => {
    const endpoint = await openSession(alice);
    const res = await post(endpoint, mallory);
    expect(res.status).toBe(403);
  });

  it("accepts a message to the user's own session", async () => {
    const endpoint = await openSession(alice);
    const res = await post(endpoint, alice);
    expect(res.status).toBe(202);
  });
});
