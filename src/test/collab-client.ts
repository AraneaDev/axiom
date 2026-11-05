/**
 * Test helpers for the wiki collaboration server: a test server on an ephemeral port and a
 * minimal Yjs client that speaks the same protocol as the browser's provider.
 */
import { createServer, Server } from 'http';
import { createRequire } from 'module';
import { AddressInfo } from 'net';

import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import * as Y from 'yjs';

import { env } from '../config/env';
import { createCollaborationServer } from '../realtime/collaboration';

// Same CJS builds the server uses, so the client shares the process's single yjs
const requireCjs = createRequire(__filename);
const syncProtocol = requireCjs('y-protocols/sync') as typeof import('y-protocols/sync');
const encoding = requireCjs('lib0/encoding') as typeof import('lib0/encoding');
const decoding = requireCjs('lib0/decoding') as typeof import('lib0/decoding');

const SERVER_ORIGIN = 'collab-test-server';

export interface CollabTestServer {
  url: string;
  close: () => Promise<void>;
}

/** Start an HTTP server that routes upgrades to the collaboration server. */
export async function startCollabTestServer(): Promise<CollabTestServer> {
  const collab = createCollaborationServer();
  const server: Server = createServer();
  server.on('upgrade', (req, socket, head) => collab.handleUpgrade(req, socket, head));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Sign an access token the way the auth service does.
 * @param userId
 */
export function tokenFor(userId: string): string {
  return jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: '15m' });
}

export interface CollabTestClient {
  ws: WebSocket;
  doc: Y.Doc;
  /** Parsed JSON payloads of message type 20 (external-change state) */
  changeMessages: Array<Record<string, unknown>>;
  /** Parsed JSON payloads of message type 21 (lock state) */
  lockMessages: Array<{ locked: boolean; byName: string | null }>;
  /** Parsed JSON payloads of message type 22 (the client's own edit access) */
  accessMessages: Array<{ canEdit: boolean }>;
  /** Times the server said this client holds the document of a session that has ended */
  sessionEnded: { count: number };
  closeCode: Promise<number>;
  /** Resolves once the client has applied the server's document state */
  synced: Promise<void>;
  close: () => Promise<void>;
}

/**
 * Connect a client to a page's room. It sends its own sync step 1 on open, answers the
 * server's, and pushes local doc changes as sync updates.
 * @param server
 * @param pageId
 * @param userId
 * @param doc - A document to reconnect with, as a browser does after a lost connection
 */
export function connectCollabClient(
  server: CollabTestServer,
  pageId: string,
  userId: string,
  doc: Y.Doc = new Y.Doc(),
): CollabTestClient {
  const ws = new WebSocket(`${server.url}/ws/wiki/${pageId}?token=${tokenFor(userId)}`);
  const sessionEnded = { count: 0 };
  const changeMessages: Array<Record<string, unknown>> = [];
  const lockMessages: Array<{ locked: boolean; byName: string | null }> = [];
  const accessMessages: Array<{ canEdit: boolean }> = [];
  let resolveSynced!: () => void;
  const synced = new Promise<void>((r) => (resolveSynced = r));
  const closeCode = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));

  ws.on('open', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeSyncStep1(encoder, doc);
    ws.send(encoding.toUint8Array(encoder));
  });

  ws.on('message', (data: Buffer) => {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(decoder);
    if (type === 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      const syncType = syncProtocol.readSyncMessage(decoder, encoder, doc, SERVER_ORIGIN);
      if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
      if (syncType === syncProtocol.messageYjsSyncStep2) resolveSynced();
    } else if (type === 20) {
      changeMessages.push(JSON.parse(decoding.readVarString(decoder)));
    } else if (type === 21) {
      lockMessages.push(JSON.parse(decoding.readVarString(decoder)));
    } else if (type === 22) {
      accessMessages.push(JSON.parse(decoding.readVarString(decoder)));
    } else if (type === 23) {
      sessionEnded.count++;
    }
  });

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === SERVER_ORIGIN || ws.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, update);
    ws.send(encoding.toUint8Array(encoder));
  });

  return {
    ws,
    doc,
    changeMessages,
    sessionEnded,
    lockMessages,
    accessMessages,
    closeCode,
    synced,
    close: async () => {
      if (ws.readyState === WebSocket.CLOSED) return;
      const closed = new Promise<void>((r) => ws.once('close', () => r()));
      ws.close();
      await closed;
    },
  };
}

/**
 * Poll until the predicate holds.
 * @param predicate
 * @param timeoutMs
 */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * Append a paragraph with the text through the client's doc (as typing would).
 * @param doc
 * @param text
 */
export function appendParagraph(doc: Y.Doc, text: string): void {
  const fragment = doc.getXmlFragment('default');
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText(text)]);
  fragment.insert(fragment.length, [paragraph]);
}
