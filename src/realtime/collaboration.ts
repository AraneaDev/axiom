/**
 * Yjs WebSocket collaboration server for real-time wiki editing.
 *
 * Implements the Yjs sync protocol manually using y-protocols,
 * handling sync messages and awareness updates between clients.
 *
 * Room naming: `wiki:{pageId}` -- each wiki page gets its own Yjs document.
 */

import { IncomingMessage } from 'http';
import { Duplex } from 'stream';

import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';

import { prisma } from '../config/database';
import { env } from '../config/env';
import type { AuthPayload } from '../middleware/auth';
import { logger } from '../utils/logger';

import {
  loadPageIntoDoc,
  scheduleSave,
  forceSave,
  setLastAuthor,
  clearAuthor,
} from './yjs-persistence';

// y-protocols are ESM-only; use dynamic import cached as promises
let syncProtocolPromise: Promise<typeof import('y-protocols/sync')> | null = null;
let awarenessProtocolPromise: Promise<typeof import('y-protocols/awareness')> | null = null;
let encodingPromise: Promise<typeof import('lib0/encoding')> | null = null;
let decodingPromise: Promise<typeof import('lib0/decoding')> | null = null;

function getSyncProtocol() {
  if (!syncProtocolPromise) syncProtocolPromise = import('y-protocols/sync');
  return syncProtocolPromise;
}
function getAwarenessProtocol() {
  if (!awarenessProtocolPromise) awarenessProtocolPromise = import('y-protocols/awareness');
  return awarenessProtocolPromise;
}
function getEncoding() {
  if (!encodingPromise) encodingPromise = import('lib0/encoding');
  return encodingPromise;
}
function getDecoding() {
  if (!decodingPromise) decodingPromise = import('lib0/decoding');
  return decodingPromise;
}

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

interface CollabClient {
  ws: WebSocket;
  userId: string;
  displayName: string;
  clientId: number;
}

interface CollabRoom {
  doc: Y.Doc;
  awareness: InstanceType<typeof import('y-protocols/awareness').Awareness> | null;
  clients: Map<WebSocket, CollabClient>;
  pageId: string;
}

const rooms = new Map<string, CollabRoom>();
let collabWss: WebSocketServer | null = null;

/**
 * Extract user ID from a WebSocket upgrade request.
 * @param req
 */
function extractAuth(req: IncomingMessage): { userId: string } | null {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let token = url.searchParams.get('token');

    if (!token) {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        token = header.slice(7);
      }
    }

    if (!token) return null;

    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

/**
 * Get or create a collaboration room for a page.
 * @param pageId
 */
async function getOrCreateRoom(pageId: string): Promise<CollabRoom> {
  const existing = rooms.get(pageId);
  if (existing) return existing;

  const awarenessProtocol = await getAwarenessProtocol();

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);

  // Load existing page content into the doc
  await loadPageIntoDoc(pageId, doc);

  // Listen for doc updates to schedule persistence
  doc.on('update', () => {
    scheduleSave(pageId, doc);
  });

  const room: CollabRoom = {
    doc,
    awareness,
    clients: new Map(),
    pageId,
  };

  rooms.set(pageId, room);
  return room;
}

/**
 * Broadcast a binary message to all clients in a room except the sender.
 * @param room
 * @param message
 * @param exclude
 */
function broadcastToRoom(room: CollabRoom, message: Uint8Array, exclude?: WebSocket): void {
  for (const [ws] of room.clients) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

/**
 * Send the current awareness state to a specific client.
 * @param room
 * @param ws
 */
async function sendAwareness(room: CollabRoom, ws: WebSocket): Promise<void> {
  if (!room.awareness) return;

  const awarenessProtocol = await getAwarenessProtocol();
  const encoding = await getEncoding();

  const clients = Array.from(room.awareness.getStates().keys());
  if (clients.length === 0) return;

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(room.awareness, clients),
  );
  const message = encoding.toUint8Array(encoder);

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(message);
  }
}

/**
 * Send the initial sync step 1 message to a newly connected client.
 * @param room
 * @param ws
 */
async function sendSyncStep1(room: CollabRoom, ws: WebSocket): Promise<void> {
  const syncProtocol = await getSyncProtocol();
  const encoding = await getEncoding();

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  const message = encoding.toUint8Array(encoder);

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(message);
  }
}

/**
 * Handle an incoming binary message from a client.
 * @param room
 * @param client
 * @param data
 */
async function handleMessage(
  room: CollabRoom,
  client: CollabClient,
  data: Uint8Array,
): Promise<void> {
  const syncProtocol = await getSyncProtocol();
  const awarenessProtocol = await getAwarenessProtocol();
  const encoding = await getEncoding();
  const decoding = await getDecoding();

  try {
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, room.doc, client);

        // If the response encoder has content, send it back
        if (encoding.length(encoder) > 1) {
          const reply = encoding.toUint8Array(encoder);
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(reply);
          }
        }

        // If we received an update (step 2 or update), broadcast to other clients
        if (
          syncMessageType === syncProtocol.messageYjsSyncStep2 ||
          syncMessageType === syncProtocol.messageYjsUpdate
        ) {
          // Track the author for persistence attribution
          setLastAuthor(room.pageId, client.userId);

          // Broadcast the update to other clients
          const updateEncoder = encoding.createEncoder();
          encoding.writeVarUint(updateEncoder, MESSAGE_SYNC);
          syncProtocol.writeUpdate(updateEncoder, Y.encodeStateAsUpdate(room.doc));
          // Actually, we should just forward the original message
          broadcastToRoom(room, data, client.ws);
        }
        break;
      }

      case MESSAGE_AWARENESS: {
        if (room.awareness) {
          const update = decoding.readVarUint8Array(decoder);
          awarenessProtocol.applyAwarenessUpdate(room.awareness, update, client);

          // Broadcast awareness to all other clients
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(encoder, update);
          broadcastToRoom(room, encoding.toUint8Array(encoder), client.ws);
        }
        break;
      }
    }
  } catch (err) {
    logger.error('Error handling collaboration message', { pageId: room.pageId }, err as Error);
  }
}

/**
 * Handle a client disconnecting from a room.
 * @param room
 * @param client
 */
async function handleDisconnect(room: CollabRoom, client: CollabClient): Promise<void> {
  room.clients.delete(client.ws);

  // Remove awareness state for this client
  if (room.awareness) {
    const awarenessProtocol = await getAwarenessProtocol();
    awarenessProtocol.removeAwarenessStates(room.awareness, [client.clientId], null);
  }

  // If room is empty, persist and clean up
  if (room.clients.size === 0) {
    await forceSave(room.pageId, room.doc);

    // Clean up awareness
    if (room.awareness) {
      room.awareness.destroy();
    }
    room.doc.destroy();
    clearAuthor(room.pageId);
    rooms.delete(room.pageId);
  }
}

/**
 * Create the collaboration WebSocket server.
 * Returns a handler for the HTTP upgrade event for paths starting with /ws/wiki/.
 */
export function createCollaborationServer(): {
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
} {
  collabWss = new WebSocketServer({ noServer: true });

  collabWss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const auth = extractAuth(req);
    if (!auth) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    // Extract page ID from the URL path: /ws/wiki/{pageId}
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathParts = url.pathname.split('/').filter(Boolean);
    // Path: ws / wiki / {pageId}
    const pageId = pathParts[2];

    if (!pageId) {
      ws.close(4002, 'Missing page ID');
      return;
    }

    // Verify the page exists
    const page = await prisma.page.findUnique({ where: { id: pageId } });
    if (!page) {
      ws.close(4004, 'Page not found');
      return;
    }

    // Fetch user display name for awareness
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { displayName: true, username: true },
    });
    const displayName = user?.displayName ?? user?.username ?? 'Unknown';

    const room = await getOrCreateRoom(pageId);

    const client: CollabClient = {
      ws,
      userId: auth.userId,
      displayName,
      clientId: room.doc.clientID + room.clients.size + 1,
    };

    room.clients.set(ws, client);

    // Send sync step 1 to the new client (server initiates sync)
    await sendSyncStep1(room, ws);

    // Send current awareness state to the new client
    await sendAwareness(room, ws);

    // Handle incoming messages
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      let uint8: Uint8Array;
      if (data instanceof Buffer) {
        uint8 = new Uint8Array(data);
      } else if (data instanceof ArrayBuffer) {
        uint8 = new Uint8Array(data);
      } else if (Array.isArray(data)) {
        uint8 = new Uint8Array(Buffer.concat(data));
      } else {
        return;
      }
      void handleMessage(room, client, uint8);
    });

    ws.on('close', () => {
      void handleDisconnect(room, client);
    });

    ws.on('error', () => {
      void handleDisconnect(room, client);
    });
  });

  return {
    handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const auth = extractAuth(req);
      if (!auth) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      collabWss!.handleUpgrade(req, socket, head, (ws) => {
        collabWss!.emit('connection', ws, req);
      });
    },
  };
}

/**
 * Get the list of active users in a collaboration room for a page.
 * @param pageId
 */
export function getActiveUsers(pageId: string): Array<{ userId: string; displayName: string }> {
  const room = rooms.get(pageId);
  if (!room) return [];

  const users: Array<{ userId: string; displayName: string }> = [];
  const seen = new Set<string>();

  for (const [, client] of room.clients) {
    if (!seen.has(client.userId)) {
      seen.add(client.userId);
      users.push({ userId: client.userId, displayName: client.displayName });
    }
  }

  return users;
}
