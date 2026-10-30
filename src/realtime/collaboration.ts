/**
 * Yjs WebSocket collaboration server for real-time wiki editing.
 *
 * Implements the Yjs sync protocol manually using y-protocols,
 * handling sync messages and awareness updates between clients.
 *
 * Message types: 0 sync and 1 awareness (y-protocols); 20 external-change state and 21 lock
 * state, both a varUint type followed by a varString of JSON. y-websocket reserves 0-3 (3 is
 * its query-awareness message), hence the gap.
 * - 20: `{ state: 'pending', externalVersionId, authorName, at, kind, restoredVersion?,
 *   draftAuthorName?, draftAt? }`
 *   or `{ state: 'resolved', byName }`
 * - 21: `{ locked, byName }`
 *
 * Room naming: `wiki:{pageId}` -- each wiki page gets its own Yjs document.
 */

import { IncomingMessage } from 'http';
import { createRequire } from 'module';
import { Duplex } from 'stream';

import type { PendingPageChange } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';

import { prisma } from '../config/database';
import { env } from '../config/env';
import { loadEditorCore, markdownToYFragment, yFragmentToMarkdown } from '../lib/editor-core';
import type { AuthPayload } from '../middleware/auth';
import { restoredVersionOf } from '../modules/wiki/page-versions';
import { canAccessSpace } from '../modules/wiki/space-permissions.service';
import { canEditPage, canViewPage } from '../modules/wiki/wiki-permissions.service';
import { ERR } from '../utils/error-messages';
import { logger } from '../utils/logger';

import { registerExternalChangeHook, setRoomLiveCheck } from './room-registry';
import {
  loadPageIntoDoc,
  scheduleSave,
  cancelScheduledSave,
  forceSave,
  setLastAuthor,
  clearAuthor,
  draftIsMergeSide,
  onPendingRecorded,
  settlePendingAfterSession,
  type SaveOptions,
} from './yjs-persistence';

// y-protocols and lib0 are loaded with a plain CommonJS require, never import(): their
// `require` export condition points at the CJS builds that share this process's CJS `yjs`,
// whereas import() (what tsx does for a dynamic import, even from CJS) takes the ESM
// condition and loads a second copy, yjs.mjs, which breaks Yjs' constructor checks.
const requireCjs = createRequire(__filename);

function getSyncProtocol(): Promise<typeof import('y-protocols/sync')> {
  return Promise.resolve(requireCjs('y-protocols/sync'));
}
function getAwarenessProtocol(): Promise<typeof import('y-protocols/awareness')> {
  return Promise.resolve(requireCjs('y-protocols/awareness'));
}
function getEncoding(): Promise<typeof import('lib0/encoding')> {
  return Promise.resolve(requireCjs('lib0/encoding'));
}
function getDecoding(): Promise<typeof import('lib0/decoding')> {
  return Promise.resolve(requireCjs('lib0/decoding'));
}

/** Test-only: the loaders the server uses, for the single-yjs probe under tsx. */
export function __protocolsForProbe() {
  return {
    sync: getSyncProtocol,
    awareness: getAwarenessProtocol,
    encoding: getEncoding,
    decoding: getDecoding,
  };
}

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_EXTERNAL_CHANGE = 20;
const MESSAGE_LOCK = 21;

/**
 * Safety net only: the merge releases its lock when it finishes. A lock nobody releases (a merge
 * that hung) frees the room after this long.
 */
const LOCK_TIMEOUT_MS = 30_000;

/** Transaction origin of content the server itself writes into a room (a merge) */
const SERVER_ORIGIN = Symbol('collab-server');

interface CollabClient {
  ws: WebSocket;
  userId: string;
  displayName: string;
  clientId: number;
  /** False for users who may only view the page: their sync updates are dropped */
  canEdit: boolean;
}

interface RoomLock {
  byName: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface CollabRoom {
  doc: Y.Doc;
  awareness: InstanceType<typeof import('y-protocols/awareness').Awareness> | null;
  clients: Map<WebSocket, CollabClient>;
  pageId: string;
  lock: RoomLock | null;
}

export type ExternalChangeMessage =
  | {
      state: 'pending';
      externalVersionId: string;
      authorName: string;
      at: string;
      kind: string;
      /** For a restore: the version number that was restored */
      restoredVersion?: number;
      draftAuthorName?: string;
      draftAt?: string;
    }
  | { state: 'resolved'; byName: string };

const rooms = new Map<string, CollabRoom>();
setRoomLiveCheck((pageId) => rooms.has(pageId));
/** In-flight or settled room creation per page, so concurrent first connections share one room */
const roomPromises = new Map<string, Promise<CollabRoom>>();
/** Rooms that are saving after their last client left; a new room for the page waits for it */
const closing = new Map<string, Promise<void>>();
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
 * Get or create a collaboration room for a page. Concurrent callers share one room.
 * @param pageId
 */
export function getOrCreateRoom(pageId: string): Promise<CollabRoom> {
  const pending = roomPromises.get(pageId);
  if (pending) return pending;

  const created = createRoom(pageId);
  roomPromises.set(pageId, created);
  // A failed load must not poison the page: the next connection retries.
  created.catch(() => {
    if (roomPromises.get(pageId) === created) roomPromises.delete(pageId);
  });
  return created;
}

/**
 * Build a room: load the converter, create the doc and fill it from the page.
 * @param pageId
 */
async function createRoom(pageId: string): Promise<CollabRoom> {
  await loadEditorCore();
  // A previous room for this page may still be saving: load only after it has.
  await closing.get(pageId);
  const awarenessProtocol = await getAwarenessProtocol();

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);

  try {
    await loadPageIntoDoc(pageId, doc);
  } catch (err) {
    awareness.destroy();
    doc.destroy();
    throw err;
  }

  const room: CollabRoom = {
    doc,
    awareness,
    clients: new Map(),
    pageId,
    lock: null,
  };

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    scheduleSave(pageId, doc);
    // Client updates are forwarded as received; the server's own writes go to everyone
    if (origin === SERVER_ORIGIN) void broadcastUpdate(room, update);
  });

  rooms.set(pageId, room);
  return room;
}

/**
 * Test-only: run the same teardown as the last client leaving.
 * @param room
 */
export async function closeRoomForTest(room: CollabRoom): Promise<void> {
  const client = { ws: {} as WebSocket, userId: '', displayName: '', clientId: 0, canEdit: false };
  room.clients.set(client.ws, client);
  await handleDisconnect(room, client);
}

/**
 * Test-only: drop a room without saving.
 * @param pageId
 */
export function releaseRoomForTest(pageId: string): void {
  const room = rooms.get(pageId);
  if (room?.lock) clearTimeout(room.lock.timer);
  cancelScheduledSave(pageId);
  room?.awareness?.destroy();
  room?.doc.destroy();
  rooms.delete(pageId);
  roomPromises.delete(pageId);
  clearAuthor(pageId);
}

/**
 * Resolves once a room that is closing for the page has finished saving (immediately if none).
 * @param pageId
 */
export function roomSettled(pageId: string): Promise<void> {
  return (closing.get(pageId) ?? Promise.resolve()).catch(() => undefined);
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
 * Send a Yjs update that the server made to every client.
 * @param room
 * @param update
 */
async function broadcastUpdate(room: CollabRoom, update: Uint8Array): Promise<void> {
  const syncProtocol = await getSyncProtocol();
  const encoding = await getEncoding();
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  broadcastToRoom(room, encoding.toUint8Array(encoder));
}

/**
 * Encode a JSON state message (type 20 or 21).
 * @param type
 * @param payload
 */
function encodeJsonMessage(type: number, payload: unknown): Uint8Array {
  const encoding = requireCjs('lib0/encoding') as typeof import('lib0/encoding');
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  encoding.writeVarString(encoder, JSON.stringify(payload));
  return encoding.toUint8Array(encoder);
}

/**
 * Send a JSON state message to one client, or to the whole room when no client is given.
 * Synchronous, so a lock reaches the clients before the caller goes on.
 * @param room
 * @param type
 * @param payload
 * @param ws
 */
function sendJson(room: CollabRoom, type: number, payload: unknown, ws?: WebSocket): void {
  const message = encodeJsonMessage(type, payload);
  if (!ws) {
    broadcastToRoom(room, message);
  } else if (ws.readyState === WebSocket.OPEN) {
    ws.send(message);
  }
}

/**
 * Display name for a user id, as shown in notices.
 * @param userId
 */
async function displayNameOf(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true, username: true },
  });
  return user?.displayName ?? user?.username ?? 'Unknown';
}

/**
 * The type-20 payload for a pending change, seen from a room. When the recorded draft is a side
 * the merge would use (draftIsMergeSide, the same rule as getPendingMerge), the payload names
 * its author and time.
 * @param room
 * @param pending - The pending row; read from the database when omitted
 */
async function pendingPayload(
  room: CollabRoom,
  pending?: PendingPageChange | null,
): Promise<ExternalChangeMessage | null> {
  const row =
    pending ?? (await prisma.pendingPageChange.findUnique({ where: { pageId: room.pageId } }));
  if (!row) return null;

  const [version, authorName, draft] = await Promise.all([
    prisma.pageVersion.findUnique({
      where: { id: row.externalVersionId },
      select: { kind: true, createdAt: true, changeDescription: true },
    }),
    displayNameOf(row.authorId),
    row.draftVersionId && draftIsMergeSide(room.pageId, row, true)
      ? prisma.pageVersion.findUnique({
          where: { id: row.draftVersionId },
          select: { createdAt: true, author: { select: { displayName: true, username: true } } },
        })
      : null,
  ]);
  if (!version) return null;
  const restored = version.kind === 'RESTORE' ? restoredVersionOf(version.changeDescription) : null;

  return {
    state: 'pending',
    externalVersionId: row.externalVersionId,
    authorName,
    at: version.createdAt.toISOString(),
    kind: version.kind,
    ...(restored !== null ? { restoredVersion: restored } : {}),
    ...(draft
      ? {
          draftAuthorName: draft.author.displayName ?? draft.author.username,
          draftAt: draft.createdAt.toISOString(),
        }
      : {}),
  };
}

/**
 * Tell a live room that an external change is waiting for it. Registered as the write helper's
 * external-change hook; a merge that leaves an earlier session's draft pending calls it too.
 * @param pageId
 * @param pending
 */
export function notifyExternalChange(pageId: string, pending: PendingPageChange): void {
  const room = rooms.get(pageId);
  if (!room) return;
  void (async () => {
    const payload = await pendingPayload(room, pending);
    if (payload) sendJson(room, MESSAGE_EXTERNAL_CHANGE, payload);
  })().catch((err: unknown) =>
    logger.error('Failed to notify room of external change', { pageId }, err as Error),
  );
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
        const syncMessageType = decoding.readVarUint(decoder);

        if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
          // Anyone may read: answer with what the client is missing
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncStep1(decoder, encoder, room.doc);
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(encoding.toUint8Array(encoder));
          }
        } else if (
          syncMessageType === syncProtocol.messageYjsSyncStep2 ||
          syncMessageType === syncProtocol.messageYjsUpdate
        ) {
          // Viewers never write, and nobody writes while a merge swaps the content
          if (!client.canEdit || room.lock) break;
          syncProtocol.readSyncStep2(decoder, room.doc, client);

          // Track the author for persistence attribution
          setLastAuthor(room.pageId, client.userId);

          // Forward the original message to the other clients
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
  if (!room.clients.has(client.ws)) return;
  room.clients.delete(client.ws);

  // An emptied room leaves the maps at once, before any await, so a client connecting
  // from here on gets a fresh room (loaded after the save below) and never joins a room
  // that is about to be destroyed.
  const emptied = room.clients.size === 0;
  if (emptied) {
    if (rooms.get(room.pageId) === room) rooms.delete(room.pageId);
    if (roomPromises.has(room.pageId)) roomPromises.delete(room.pageId);
  }

  const removeAwareness = async () => {
    if (!room.awareness) return;
    const awarenessProtocol = await getAwarenessProtocol();
    awarenessProtocol.removeAwarenessStates(room.awareness, [client.clientId], null);
  };

  if (!emptied) {
    await removeAwareness();
    return;
  }

  // Persist and clean up. New rooms for this page wait on `closing`, which is set before
  // the first await. With a change pending, the save is a SESSION_DRAFT and the pending row stays.
  const closed = (async () => {
    try {
      await removeAwareness();
      // A failed save leaves the pending row alone: the next session decides with a fresh load
      if ((await forceSave(room.pageId, room.doc)) !== 'failed') {
        await settlePendingAfterSession(room.pageId);
      }
    } finally {
      if (room.lock) clearTimeout(room.lock.timer);
      room.lock = null;
      room.awareness?.destroy();
      room.doc.destroy();
      clearAuthor(room.pageId);
    }
  })();
  closing.set(room.pageId, closed);
  try {
    await closed;
  } finally {
    if (closing.get(room.pageId) === closed) closing.delete(room.pageId);
  }
}

/**
 * Convert a ws message payload to bytes.
 * @param data
 */
function toBytes(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array | null {
  if (data instanceof Buffer) return new Uint8Array(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return null;
}

/**
 * Admit a connection: check access, join the room, sync, and replay lock and pending state.
 * Messages that arrive while this runs are queued and handled in order once the client joined.
 * @param ws
 * @param req
 */
async function acceptConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
  const queued: Uint8Array[] = [];
  let joined: { room: CollabRoom; client: CollabClient } | null = null;
  let member: { room: CollabRoom; client: CollabClient } | null = null;
  let closed = false;

  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    const bytes = toBytes(data);
    if (!bytes) return;
    if (joined) void handleMessage(joined.room, joined.client, bytes);
    else queued.push(bytes);
  });
  const onClose = () => {
    if (closed) return;
    closed = true;
    if (member) {
      const { room, client } = member;
      handleDisconnect(room, client).catch((err: unknown) =>
        logger.error(
          'Failed to close collaboration session',
          { pageId: room.pageId },
          err as Error,
        ),
      );
    }
  };
  ws.on('close', onClose);
  ws.on('error', onClose);

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
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, spaceId: true },
  });
  if (!page) {
    ws.close(4004, ERR.PAGE_NOT_FOUND);
    return;
  }

  // The same checks as the REST routes: space access first, then the page's restrictions
  const [spaceView, pageView] = await Promise.all([
    canAccessSpace(page.spaceId, auth.userId, 'VIEW'),
    canViewPage(auth.userId, pageId),
  ]);
  if (!spaceView || !pageView) {
    ws.close(4003, 'Forbidden');
    return;
  }
  const [spaceEdit, pageEdit, displayName] = await Promise.all([
    canAccessSpace(page.spaceId, auth.userId, 'EDIT'),
    canEditPage(auth.userId, pageId),
    displayNameOf(auth.userId),
  ]);
  if (closed) return;

  const room = await getOrCreateRoom(pageId);

  const client: CollabClient = {
    ws,
    userId: auth.userId,
    displayName,
    clientId: room.doc.clientID + room.clients.size + 1,
    canEdit: spaceEdit && pageEdit,
  };

  room.clients.set(ws, client);
  member = { room, client };
  if (closed) {
    // Left while the room was loading: run the normal teardown so the room does not linger
    await handleDisconnect(room, client);
    return;
  }

  // Send sync step 1 to the new client (server initiates sync)
  await sendSyncStep1(room, ws);

  // Send current awareness state to the new client
  await sendAwareness(room, ws);

  // Late joiners learn about a running merge and a waiting change at once
  if (room.lock) {
    sendJson(room, MESSAGE_LOCK, { locked: true, byName: room.lock.byName }, ws);
  }
  const pending = await pendingPayload(room);
  if (pending) sendJson(room, MESSAGE_EXTERNAL_CHANGE, pending, ws);

  for (const bytes of queued.splice(0)) void handleMessage(room, client, bytes);
  joined = { room, client };
}

/**
 * Create the collaboration WebSocket server.
 * Returns a handler for the HTTP upgrade event for paths starting with /ws/wiki/.
 */
export function createCollaborationServer(): {
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
} {
  collabWss = new WebSocketServer({ noServer: true });
  // The page write path learns about rooms through the registry, never by importing this module
  registerExternalChangeHook(notifyExternalChange);
  // A session save that finds Page.body changed under it records a pending change itself
  onPendingRecorded(notifyExternalChange);

  collabWss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    acceptConnection(ws, req).catch((err: unknown) => {
      logger.error('Failed to open collaboration session', {}, err as Error);
      ws.close(1011, 'Internal error');
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
 * Whether a collaboration room currently exists for the page.
 * @param pageId
 */
export function isRoomLive(pageId: string): boolean {
  return rooms.has(pageId);
}

/**
 * The live room for a page, if there is one.
 * @param pageId
 */
export function getLiveRoom(pageId: string): CollabRoom | undefined {
  return rooms.get(pageId);
}

/**
 * The live room's document as Markdown.
 * @param room
 */
export function roomMarkdown(room: CollabRoom): string {
  return yFragmentToMarkdown(room.doc.getXmlFragment('default'));
}

/**
 * Ask every client that may edit for what the server is missing: updates dropped while the room
 * was locked would otherwise leave them out of sync, and Yjs holds back their later updates
 * until the gap is filled. Their sync step 2 reply brings the dropped edits in.
 * @param room
 */
function resyncEditors(room: CollabRoom): void {
  const syncProtocol = requireCjs('y-protocols/sync') as typeof import('y-protocols/sync');
  const encoding = requireCjs('lib0/encoding') as typeof import('lib0/encoding');
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  const message = encoding.toUint8Array(encoder);
  for (const [ws, client] of room.clients) {
    if (client.canEdit && ws.readyState === WebSocket.OPEN) ws.send(message);
  }
}

/**
 * Lock a live room: every client goes read-only and their sync updates are dropped until the
 * returned release is called. A timer releases it after 30 seconds as a safety net.
 * @param pageId
 * @param byName - Shown to the clients as who is merging
 * @returns The release function; a no-op when no room is live; null when the room is already
 *   locked
 */
export function lockRoom(pageId: string, byName: string): (() => void) | null {
  const room = rooms.get(pageId);
  if (!room) return () => undefined;
  if (room.lock) return null;

  const release = () => {
    if (room.lock !== lock) return;
    clearTimeout(lock.timer);
    room.lock = null;
    sendJson(room, MESSAGE_LOCK, { locked: false, byName });
    resyncEditors(room);
  };
  const lock: RoomLock = { byName, timer: setTimeout(release, LOCK_TIMEOUT_MS) };
  room.lock = lock;
  sendJson(room, MESSAGE_LOCK, { locked: true, byName });
  return release;
}

/**
 * Whether the page's live room is locked for a merge.
 * @param pageId
 */
export function isRoomLocked(pageId: string): boolean {
  return Boolean(rooms.get(pageId)?.lock);
}

/**
 * Replace the live room's content with the Markdown, in one Yjs transaction that every client
 * receives.
 * @param room
 * @param markdown - Normalised Markdown
 */
export function replaceRoomContent(room: CollabRoom, markdown: string): void {
  room.doc.transact(() => {
    markdownToYFragment(markdown, room.doc.getXmlFragment('default'));
  }, SERVER_ORIGIN);
}

/**
 * Tell every client in the page's live room that the pending change was merged.
 * @param pageId
 * @param byName
 */
export function announceMergeResolved(pageId: string, byName: string): void {
  const room = rooms.get(pageId);
  if (!room) return;
  sendJson(room, MESSAGE_EXTERNAL_CHANGE, { state: 'resolved', byName });
}

/**
 * Save the live room's document now, if there is one. Used before a REST save so the page
 * holds what the editor shows.
 * @param pageId
 * @param opts - Who saves, and the change description for the version the save creates
 * @returns True when a live room was saved
 */
export async function flushRoom(pageId: string, opts: SaveOptions = {}): Promise<boolean> {
  const room = rooms.get(pageId);
  if (!room) return false;
  await forceSave(pageId, room.doc, opts);
  return true;
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
