/**
 * Room authorization on the realtime WebSocket server, exercised with real ws clients
 * against the real server on an ephemeral port.
 */
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';

import { prisma } from '../config/database';
import { setSpacePermission } from '../modules/wiki/space-permissions.service';
import { deletePage, updatePage } from '../modules/wiki/wiki.service';
import { tokenFor, waitFor } from '../test/collab-client';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  TestContext,
  TestUser,
} from '../test/factory';
import { authDel, authGet, authPost } from '../test/helpers';

import { broadcastToRoom, broadcastToUser } from './broadcast';
import { createWebSocketServer, getClients } from './ws-server';

/** A room whose access check fails the way a database outage would. */
const FAILING_ROOM = 'project:cexplodes0000000000000000';

vi.mock('./room-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./room-access')>();
  return {
    ...actual,
    canJoinRoom: (userId: string, room: string) =>
      room === FAILING_ROOM
        ? Promise.reject(new Error('database unavailable'))
        : actual.canJoinRoom(userId, room),
  };
});

interface RealtimeTestClient {
  ws: WebSocket;
  userId: string;
  messages: Array<Record<string, unknown>>;
  send: (msg: unknown) => void;
  close: () => Promise<void>;
}

let httpServer: Server;
let wss: WebSocketServer;
let baseUrl: string;
const clients: RealtimeTestClient[] = [];

async function connect(userId: string): Promise<RealtimeTestClient> {
  const ws = new WebSocket(`${baseUrl}/ws?token=${tokenFor(userId)}`);
  const messages: Array<Record<string, unknown>> = [];
  ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  // The server registers the socket synchronously on upgrade; wait until it is listed
  await waitFor(() => [...getClients()].some((c) => c.userId === userId));
  const client: RealtimeTestClient = {
    ws,
    userId,
    messages,
    send: (msg) => ws.send(JSON.stringify(msg)),
    close: () =>
      new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.once('close', () => resolve());
        ws.close();
      }),
  };
  clients.push(client);
  return client;
}

/**
 * Rooms the server holds for every socket of this user.
 * @param userId
 */
function serverRooms(userId: string): Set<string> {
  const rooms = new Set<string>();
  for (const c of getClients()) {
    if (c.userId === userId) for (const r of c.rooms) rooms.add(r);
  }
  return rooms;
}

function deniedRooms(client: RealtimeTestClient): string[] {
  return client.messages
    .filter((m) => m.type === 'subscribe:denied')
    .flatMap((m) => m.rooms as string[]);
}

/**
 * Send a sentinel event to the client's own user room and wait for it. Messages on one
 * socket arrive in order, so anything broadcast before the sentinel has arrived by then.
 * @param client
 */
async function flush(client: RealtimeTestClient): Promise<void> {
  const marker = `sentinel-${Math.random()}`;
  broadcastToUser(client.userId, {
    type: 'notification',
    userId: client.userId,
    notificationId: marker,
  });
  await waitFor(() => client.messages.some((m) => m.notificationId === marker));
}

describe('Realtime room authorization', () => {
  let ctx: TestContext;
  let member: TestUser;
  let outsider: TestUser;
  let issueId: string;
  let spaceId: string;

  beforeAll(async () => {
    ctx = await createTestContext(`wsrooms${Date.now()}`);
    member = await addMemberToContext(ctx);
    ctx.member = member;
    outsider = await createTestUser();

    const issueRes = await authPost(`/api/projects/${ctx.projectId}/issues`, ctx.owner.token, {
      title: 'Realtime room issue',
      type: 'TASK',
      priority: 'MEDIUM',
    });
    expect(issueRes.status).toBe(201);
    issueId = issueRes.body.id;

    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Rooms Space', slug: 'rooms-space' },
    });
    spaceId = space.id;

    httpServer = createServer();
    wss = createWebSocketServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
    await waitFor(() => getClients().size === 0);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    httpServer.closeAllConnections();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: outsider.id } });
  });

  it('delivers project events to a team member', async () => {
    const client = await connect(member.id);
    const room = `project:${ctx.projectId}`;
    client.send({ type: 'subscribe', rooms: [room] });
    await waitFor(() => serverRooms(member.id).has(room));
    // The client is told when it's in
    await waitFor(() => client.messages.some((m) => m.type === 'subscribed' && m.room === room));

    broadcastToRoom(room, { type: 'issue:updated', projectId: ctx.projectId, issueId });
    await waitFor(() => client.messages.some((m) => m.type === 'issue:updated'));
    expect(deniedRooms(client)).toEqual([]);
  });

  it('grants VIEW-level space rooms and denies them to outsiders', async () => {
    const memberClient = await connect(member.id);
    const outsiderClient = await connect(outsider.id);
    const room = `space:${spaceId}`;
    memberClient.send({ type: 'subscribe', rooms: [room] });
    outsiderClient.send({ type: 'subscribe', rooms: [room] });
    await waitFor(() => serverRooms(member.id).has(room));
    await waitFor(() => deniedRooms(outsiderClient).includes(room));
    expect(serverRooms(outsider.id).has(room)).toBe(false);
  });

  it('denies a non-member and sends them nothing from that project', async () => {
    const client = await connect(outsider.id);
    const room = `project:${ctx.projectId}`;
    client.send({ type: 'subscribe', rooms: [room] });
    await waitFor(() => deniedRooms(client).includes(room));
    expect(serverRooms(outsider.id).has(room)).toBe(false);

    broadcastToRoom(room, { type: 'issue:updated', projectId: ctx.projectId, issueId });
    await flush(client);
    expect(client.messages.some((m) => m.type === 'issue:updated')).toBe(false);
  });

  it("denies another user's personal room", async () => {
    const client = await connect(outsider.id);
    const room = `user:${ctx.owner.id}`;
    client.send({ type: 'subscribe', rooms: [room] });
    await waitFor(() => deniedRooms(client).includes(room));

    broadcastToUser(ctx.owner.id, {
      type: 'notification',
      userId: ctx.owner.id,
      notificationId: 'not-for-outsider',
    });
    await flush(client);
    expect(client.messages.some((m) => m.notificationId === 'not-for-outsider')).toBe(false);
  });

  it("denies an issue room in a project the user can't view", async () => {
    const outsiderClient = await connect(outsider.id);
    const memberClient = await connect(member.id);
    const room = `issue:${issueId}`;
    outsiderClient.send({ type: 'subscribe', rooms: [room] });
    memberClient.send({ type: 'subscribe', rooms: [room] });
    await waitFor(() => deniedRooms(outsiderClient).includes(room));
    await waitFor(() => serverRooms(member.id).has(room));
    expect(serverRooms(outsider.id).has(room)).toBe(false);
  });

  it('denies unknown prefixes, malformed ids and ids that do not exist', async () => {
    const client = await connect(ctx.owner.id);
    const rooms = [
      'admin:everything',
      'project',
      'project:',
      'project:../../etc',
      'project:cdoesnotexist000000000000',
      'space:cdoesnotexist000000000000',
      'issue:cdoesnotexist000000000000',
    ];
    client.send({ type: 'subscribe', rooms });
    await waitFor(() => deniedRooms(client).length === rooms.length);
    expect(deniedRooms(client).sort()).toEqual([...rooms].sort());
    expect([...serverRooms(ctx.owner.id)]).toEqual([`user:${ctx.owner.id}`]);
  });

  it('leaves no room behind when unsubscribe arrives before the check finishes', async () => {
    const client = await connect(member.id);
    const room = `project:${ctx.projectId}`;
    const later = `space:${spaceId}`;
    client.send({ type: 'subscribe', rooms: [room] });
    client.send({ type: 'unsubscribe', rooms: [room] });
    // Checks for one socket run in order, so once the later room is granted the first
    // check has finished too.
    client.send({ type: 'subscribe', rooms: [later] });
    await waitFor(() => serverRooms(member.id).has(later));
    expect(serverRooms(member.id).has(room)).toBe(false);

    broadcastToRoom(room, { type: 'issue:updated', projectId: ctx.projectId, issueId });
    await flush(client);
    expect(client.messages.some((m) => m.type === 'issue:updated')).toBe(false);
  });

  it('caps the rooms per request and per socket', async () => {
    await prisma.issue.createMany({
      data: Array.from({ length: 70 }, (_, i) => ({
        projectId: ctx.projectId,
        number: 1000 + i,
        title: `Cap ${i}`,
        body: '',
        creatorId: ctx.owner.id,
      })),
    });
    const issues = await prisma.issue.findMany({
      where: { projectId: ctx.projectId, number: { gte: 1000 } },
      select: { id: true },
      orderBy: { number: 'asc' },
    });
    const rooms = issues.map((i) => `issue:${i.id}`);
    const client = await connect(member.id);

    // One request of 60: only the first 50 are considered, and the socket's own user room
    // counts toward its total of 50, so 49 issue rooms fit and the other 11 are refused
    client.send({ type: 'subscribe', rooms: rooms.slice(0, 60) });
    await waitFor(() => deniedRooms(client).length === 11);
    await waitFor(() => serverRooms(member.id).size === 50);
    expect(deniedRooms(client).sort()).toEqual(rooms.slice(49, 60).sort());
    // Everything refused up front goes out in one frame, however long the request
    expect(client.messages.filter((m) => m.type === 'subscribe:denied')).toHaveLength(1);

    // The socket is full: nothing more fits
    client.send({ type: 'subscribe', rooms: rooms.slice(60, 62) });
    await waitFor(() => deniedRooms(client).length === 13);
    expect(serverRooms(member.id).size).toBe(50);
  });

  it('reports a failed check as an error, not a denial', async () => {
    const client = await connect(member.id);
    client.send({ type: 'subscribe', rooms: [FAILING_ROOM] });
    await waitFor(() =>
      client.messages.some((m) => m.type === 'subscribe:error' && m.room === FAILING_ROOM),
    );
    expect(deniedRooms(client)).toEqual([]);
    expect(serverRooms(member.id).has(FAILING_ROOM)).toBe(false);
  });

  it('does not refuse a room that is still pending when it is asked for again past the cap', async () => {
    const client = await connect(member.id);
    const room = `project:${ctx.projectId}`;
    client.send({ type: 'subscribe', rooms: [room] });
    // The same room again, at index 50 of a second request
    client.send({ type: 'subscribe', rooms: Array.from({ length: 51 }, () => room) });
    await waitFor(() => serverRooms(member.id).has(room));
    await flush(client);
    expect(deniedRooms(client)).toEqual([]);
  });

  it('denies a space room to an org member the space permissions leave out', async () => {
    const restricted = await prisma.wikiSpace.create({
      data: {
        teamId: ctx.teamId,
        name: 'Restricted Space',
        slug: 'restricted-space',
        permissions: { create: { userId: ctx.owner.id, level: 'ADMIN' } },
      },
    });
    const client = await connect(member.id);
    const room = `space:${restricted.id}`;
    client.send({ type: 'subscribe', rooms: [room] });
    await waitFor(() => deniedRooms(client).includes(room));
    expect(serverRooms(member.id).has(room)).toBe(false);
  });

  it('denies a project room to an org member who is not on the project team', async () => {
    const orgOnly = await createTestUser();
    await prisma.orgMembership.create({
      data: { orgId: ctx.orgId, userId: orgOnly.id, role: 'MEMBER' },
    });
    try {
      const client = await connect(orgOnly.id);
      const room = `project:${ctx.projectId}`;
      client.send({ type: 'subscribe', rooms: [room] });
      await waitFor(() => deniedRooms(client).includes(room));
      expect(serverRooms(orgOnly.id).has(room)).toBe(false);
    } finally {
      await Promise.all(clients.splice(0).map((c) => c.close()));
      await prisma.user.deleteMany({ where: { id: orgOnly.id } });
    }
  });

  it('adds no room to a socket that closed while its check was running', async () => {
    const client = await connect(member.id);
    const socket = [...getClients()].find((c) => c.userId === member.id)! as unknown as {
      rooms: Set<string>;
      checkQueue: Promise<void>;
    };
    const room = `project:${ctx.projectId}`;
    client.send({ type: 'subscribe', rooms: [room] });
    await client.close();
    await waitFor(() => getClients().size === 0);
    await socket.checkQueue;
    expect(socket.rooms.has(room)).toBe(false);
  });

  it('cuts a removed org member off from REST, new subscriptions and rooms already held', async () => {
    const leaver = await addMemberToContext(ctx);
    const space = await prisma.wikiSpace.create({
      data: {
        teamId: ctx.teamId,
        name: 'Leaver Space',
        slug: 'leaver-space',
        permissions: { create: { userId: leaver.id, level: 'EDIT' } },
      },
    });
    try {
      const room = `project:${ctx.projectId}`;
      const held = await connect(leaver.id);
      held.send({ type: 'subscribe', rooms: [room] });
      await waitFor(() => held.messages.some((m) => m.type === 'subscribed' && m.room === room));
      expect((await authGet(`/api/projects/${ctx.projectId}`, leaver.token)).status).toBe(200);

      const starPage = await prisma.page.create({
        data: { spaceId: space.id, title: 'Starred', slug: 'starred', body: 'x' },
      });
      await prisma.starredPage.create({ data: { userId: leaver.id, pageId: starPage.id } });
      const res = await authDel(`/api/orgs/${ctx.orgId}/members/${leaver.id}`, ctx.owner.token);
      expect(res.status).toBeLessThan(300);

      // Nothing the org granted survives: team membership and the space permission are gone
      expect(await prisma.teamMembership.count({ where: { userId: leaver.id } })).toBe(0);
      expect(await prisma.spacePermission.count({ where: { userId: leaver.id } })).toBe(0);
      expect(await prisma.starredPage.count({ where: { userId: leaver.id } })).toBe(0);
      expect((await authGet(`/api/projects/${ctx.projectId}`, leaver.token)).status).toBe(403);

      // The socket that held the room no longer gets its events
      await waitFor(() => !serverRooms(leaver.id).has(room));
      broadcastToRoom(room, { type: 'issue:updated', projectId: ctx.projectId, issueId });
      const fresh = await connect(leaver.id);
      fresh.send({ type: 'subscribe', rooms: [room] });
      await waitFor(() => deniedRooms(fresh).includes(room));
      expect(serverRooms(leaver.id).has(room)).toBe(false);
      expect(held.messages.some((m) => m.type === 'issue:updated')).toBe(false);
    } finally {
      await Promise.all(clients.splice(0).map((c) => c.close()));
      await prisma.wikiSpace.delete({ where: { id: space.id } });
      await prisma.user.deleteMany({ where: { id: leaver.id } });
    }
  });

  it('drops a held space room when new space permissions leave the user out', async () => {
    const space2 = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Closing Space', slug: 'closing-space' },
    });
    const client = await connect(member.id);
    const room = `space:${space2.id}`;
    client.send({ type: 'subscribe', rooms: [room] });
    await waitFor(() => client.messages.some((m) => m.type === 'subscribed' && m.room === room));

    // The first custom permission turns an open space into a restricted one
    await setSpacePermission(space2.id, { userId: ctx.owner.id, level: 'ADMIN' });
    await waitFor(() => deniedRooms(client).includes(room));
    expect(serverRooms(member.id).has(room)).toBe(false);
  });

  it("keeps a VIEW-restricted page's id out of space events for members who can't view it", async () => {
    const space3 = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Events Space', slug: 'events-space' },
    });
    const open = await prisma.page.create({
      data: { spaceId: space3.id, title: 'Open', slug: 'open', body: 'a' },
    });
    const secret = await prisma.page.create({
      data: { spaceId: space3.id, title: 'Secret', slug: 'secret', body: 'a' },
    });
    await prisma.pageRestriction.create({
      data: { pageId: secret.id, type: 'VIEW', userId: ctx.owner.id },
    });
    const client = await connect(member.id);
    const room = `space:${space3.id}`;
    client.send({ type: 'subscribe', rooms: [room] });
    await waitFor(() => client.messages.some((m) => m.type === 'subscribed' && m.room === room));

    await updatePage(space3.id, 'secret', ctx.owner.id, { body: 'b' });
    await updatePage(space3.id, 'open', ctx.owner.id, { body: 'b' });
    await deletePage(space3.id, 'secret', ctx.owner.id);
    await waitFor(() => client.messages.filter((m) => m.type === 'wiki:updated').length === 3);

    const events = client.messages.filter((m) => m.type === 'wiki:updated');
    // The member still learns the space changed, so the tree refreshes
    expect(events.every((m) => m.spaceId === space3.id)).toBe(true);
    expect(JSON.stringify(client.messages)).not.toContain(secret.id);
    expect(events.some((m) => m.pageId === open.id)).toBe(true);
  });
});
