import { Server as HttpServer, IncomingMessage } from 'http';
import { URL } from 'url';

import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';

import { env } from '../config/env';
import type { AuthPayload } from '../middleware/auth';

import { createCollaborationServer } from './collaboration';
import type { ClientMessage } from './events';

const HEARTBEAT_INTERVAL = 30_000;

interface AuthenticatedSocket extends WebSocket {
  userId: string;
  rooms: Set<string>;
  isAlive: boolean;
}

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

/**
 * Attach a WebSocket server to an existing HTTP server.
 * @param server
 */
export function createWebSocketServer(server: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

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

    wss!.handleUpgrade(req, socket, head, (ws) => {
      const authSocket = ws as AuthenticatedSocket;
      authSocket.userId = userId;
      authSocket.rooms = new Set();
      authSocket.isAlive = true;

      wss!.emit('connection', authSocket, req);
    });
  });

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
          for (const room of msg.rooms) {
            if (typeof room === 'string' && room.length < 200) {
              ws.rooms.add(room);
            }
          }
        } else if (msg.type === 'unsubscribe' && Array.isArray(msg.rooms)) {
          for (const room of msg.rooms) {
            ws.rooms.delete(room);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      ws.rooms.clear();
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
