import { Server as HttpServer, IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { URL } from 'url';

import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';

import { prisma } from '../config/database';
import { env } from '../config/env';
import type { AuthPayload } from '../middleware/auth';
import { logger } from '../utils/logger';

import {
  registerAccessRevokedHook,
  registerDisconnectHook,
  type RevocationScope,
} from './access-revocation';
import { createCollaborationServer } from './collaboration';
import type { ClientMessage, SubscriptionMessage } from './events';
import { canJoinRoom, MAX_ROOMS_PER_REQUEST, MAX_ROOMS_PER_SOCKET } from './room-access';

const HEARTBEAT_INTERVAL = 30_000;
/** Client messages are small JSON commands; refuse anything larger. */
const MAX_PAYLOAD = 64 * 1024;

interface AuthenticatedSocket extends WebSocket {
  userId: string;
  /** Rooms the socket was granted and receives broadcasts for */
  rooms: Set<string>;
  /** Rooms awaiting their access check, each with the ticket of its latest request */
  pendingRooms: Map<string, number>;
  /** Tail of the socket's check queue: checks run one at a time, in arrival order */
  checkQueue: Promise<void>;
  isAlive: boolean;
}

let nextTicket = 0;

let wss: WebSocketServer | null = null;

/**
 * Returns the active WebSocket server instance (or null if not started).
 */
export function getWSS(): WebSocketServer | null {
  return wss;
}

/**
 * Returns all connected sockets (typed with auth info).
 */
export function getClients(): Set<AuthenticatedSocket> {
  if (!wss) return new Set();
  return wss.clients as Set<AuthenticatedSocket>;
}

/**
 * Authenticate an incoming WebSocket upgrade request.
 * Accepts JWT from `?token=` query param or `Authorization: Bearer ...` header.
 * @param req
 */
function extractUserId(req: IncomingMessage): string | null {
  try {
    // Try query param first
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let token = url.searchParams.get('token');

    // Fall back to Authorization header
    if (!token) {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        token = header.slice(7);
      }
    }

    if (!token) return null;

    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
    return payload.userId;
  } catch {
    return null;
  }
}

function sendToSocket(ws: AuthenticatedSocket, message: SubscriptionMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function sendDenied(ws: AuthenticatedSocket, rooms: string[]): void {
  if (rooms.length > 0) sendToSocket(ws, { type: 'subscribe:denied', rooms });
}

/**
 * Queue an access check for each requested room. Rooms past the per-request cap, or that
 * would take the socket past its total cap, are refused straight away without a lookup,
 * all in one reply.
 * A check's result only counts if the room is still pending under the same ticket when it
 * finishes: an unsubscribe, or the socket closing, in the meantime discards it. An
 * unsubscribe followed by a new subscribe queues a fresh check under a new ticket.
 * @param ws - The subscribing socket
 * @param requested - The raw `rooms` array from the client
 */
function handleSubscribe(ws: AuthenticatedSocket, requested: unknown[]): void {
  const refused: string[] = [];
  requested.forEach((room, index) => {
    if (typeof room !== 'string') return;
    if (room.length > 200) {
      refused.push(room.slice(0, 200));
      return;
    }
    // Already granted, or its check is already queued and will answer: nothing to do, and
    // no cap applies, since refusing it now would contradict the pending check
    if (ws.rooms.has(room) || ws.pendingRooms.has(room)) return;
    if (
      index >= MAX_ROOMS_PER_REQUEST ||
      ws.rooms.size + ws.pendingRooms.size >= MAX_ROOMS_PER_SOCKET
    ) {
      refused.push(room);
      return;
    }

    const ticket = ++nextTicket;
    ws.pendingRooms.set(room, ticket);
    ws.checkQueue = ws.checkQueue
      .then(async () => {
        // Unsubscribed while queued: skip the lookup altogether
        if (ws.pendingRooms.get(room) !== ticket) return;
        const allowed = await canJoinRoom(ws.userId, room);
        if (ws.pendingRooms.get(room) !== ticket || ws.readyState !== WebSocket.OPEN) return;
        ws.pendingRooms.delete(room);
        if (allowed) {
          ws.rooms.add(room);
          sendToSocket(ws, { type: 'subscribed', room });
        } else {
          sendDenied(ws, [room]);
        }
      })
      .catch((err) => {
        // A failed check is not a refusal: report it as an error so the client keeps the
        // room and asks again on reconnect. It must not stall the rest of the queue either.
        logger.error('Realtime room check failed', { room }, err as Error);
        if (ws.pendingRooms.get(room) !== ticket) return;
        ws.pendingRooms.delete(room);
        sendToSocket(ws, { type: 'subscribe:error', room });
      });
  });
  sendDenied(ws, refused);
}

/**
 * Re-check held rooms after access was taken away. A user scope re-checks all of that user's
 * rooms; a space scope only the `space:<id>` room on every socket holding it; a page scope
 * nothing here (pages have no realtime room; their space events carry no restricted ids).
 * A check that throws counts as lost access. Dropped rooms are reported to the client as
 * subscribe:denied, and the count is logged. Each re-check queues behind any check already
 * running on the socket, so a grant decided on the old permissions can't land after it.
 * @param scope - What the change can affect
 */
async function revalidateRooms(scope: RevocationScope): Promise<void> {
  if ('pageId' in scope) return;
  const runs: Promise<void>[] = [];
  for (const ws of getClients()) {
    let targets: string[];
    if ('userId' in scope) {
      if (ws.userId !== scope.userId) continue;
      targets = [...ws.rooms];
    } else {
      const room = `space:${scope.spaceId}`;
      if (!ws.rooms.has(room)) continue;
      targets = [room];
    }
    ws.checkQueue = ws.checkQueue
      .then(async () => {
        const lost: string[] = [];
        for (const room of targets) {
          if (!ws.rooms.has(room)) continue;
          let allowed = false;
          try {
            allowed = await canJoinRoom(ws.userId, room);
          } catch (err) {
            // Fail closed: a check that can't run doesn't keep the room
            logger.error(
              'Realtime room re-check failed',
              { userId: ws.userId, room },
              err as Error,
            );
          }
          if (!allowed) {
            ws.rooms.delete(room);
            lost.push(room);
          }
        }
        if (lost.length > 0) {
          logger.info('Realtime rooms dropped after an access change', {
            userId: ws.userId,
            rooms: lost.length,
          });
          sendDenied(ws, lost);
        }
      })
      .catch((err) => {
        // Keep the socket's queue alive: a rejected tail would skip every later check
        logger.error('Realtime room re-check failed', { userId: ws.userId }, err as Error);
      });
    runs.push(ws.checkQueue);
  }
  await Promise.all(runs);
}

registerAccessRevokedHook(revalidateRooms);
registerDisconnectHook((userId) => {
  for (const ws of getClients()) {
    if (ws.userId === userId) ws.close(4001, 'Account deactivated');
  }
});

/**
 * Attach a WebSocket server to an existing HTTP server.
 * @param server
 */
export function createWebSocketServer(server: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  // Create collaboration WebSocket server for wiki real-time editing
  const collab = createCollaborationServer();

  // Handle upgrade manually so we can authenticate before accepting
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;

    // Route /ws/wiki/* paths to the collaboration server
    if (pathname.startsWith('/ws/wiki/')) {
      collab.handleUpgrade(req, socket, head);
      return;
    }

    // Only handle /ws path for the main realtime server
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const userId = extractUserId(req);
    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    void acceptUpgrade(req, socket, head, userId);
  });

  // Like authenticate on the REST side: a deactivated (or deleted) account is refused even
  // while its token is still valid
  async function acceptUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    userId: string,
  ): Promise<void> {
    const user = await prisma.user
      .findUnique({ where: { id: userId }, select: { deactivatedAt: true } })
      .catch(() => null);
    if (!user || user.deactivatedAt) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss!.handleUpgrade(req, socket, head, (ws) => {
      const authSocket = ws as AuthenticatedSocket;
      authSocket.userId = userId;
      authSocket.rooms = new Set();
      authSocket.pendingRooms = new Map();
      authSocket.checkQueue = Promise.resolve();
      authSocket.isAlive = true;

      wss!.emit('connection', authSocket, req);
    });
  }

  wss.on('connection', (ws: AuthenticatedSocket) => {
    // Auto-subscribe to personal room
    ws.rooms.add(`user:${ws.userId}`);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;

        if (msg.type === 'subscribe' && Array.isArray(msg.rooms)) {
          handleSubscribe(ws, msg.rooms);
        } else if (msg.type === 'unsubscribe' && Array.isArray(msg.rooms)) {
          for (const room of msg.rooms) {
            if (typeof room !== 'string') continue;
            ws.rooms.delete(room);
            // Drops a check in flight: its result no longer matches a pending ticket
            ws.pendingRooms.delete(room);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      ws.rooms.clear();
      ws.pendingRooms.clear();
    });
  });

  // Heartbeat: ping every 30s, close dead connections
  const heartbeat = setInterval(() => {
    if (!wss) return;
    for (const ws of wss.clients as Set<AuthenticatedSocket>) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  return wss;
}

/**
 * Broadcast a message to all clients subscribed to a given room.
 * @param room - The room name (e.g. "project:abc123")
 * @param payload - JSON-serializable event data
 */
export function broadcastToRoom(room: string, payload: Record<string, unknown>): void {
  const clients = getClients();
  const message = JSON.stringify(payload);
  for (const client of clients) {
    if (client.rooms.has(room) && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}
