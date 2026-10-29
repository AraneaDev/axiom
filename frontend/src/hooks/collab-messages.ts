/**
 * The collaboration server's JSON state messages (see src/realtime/collaboration.ts):
 * type 20 external-change state and type 21 lock state, each a varUint message type followed by a
 * varString of JSON. y-websocket hands the handler a decoder positioned after the type.
 */

export const MESSAGE_EXTERNAL_CHANGE = 20;
export const MESSAGE_LOCK = 21;

/** An external change (agent, API, restore) waiting to be merged into the live session */
export interface PendingChange {
  externalVersionId: string;
  authorName: string;
  /** ISO time of the external change */
  at: string;
  /** PageVersion kind of the external change: EXTERNAL or RESTORE */
  kind: string;
  /** For a restore: the version number that was restored */
  restoredVersion?: number;
  /** Set when an ended session left unmerged edits */
  draftAuthorName?: string;
  draftAt?: string;
}

export type ExternalChangeMessage =
  | ({ state: 'pending' } & PendingChange)
  | { state: 'resolved'; byName: string };

export interface LockMessage {
  locked: boolean;
  byName: string;
}

/** The part of a lib0 decoder this module reads */
interface DecoderLike {
  arr: Uint8Array;
  pos: number;
}

/**
 * Read the JSON payload after the message type. Returns null when the message carries no payload
 * (y-websocket and BroadcastChannel peers may send bare messages) or the payload is not JSON.
 * @param decoder - A lib0 decoder positioned after the message type
 */
export function readJsonPayload(decoder: DecoderLike): unknown {
  const { arr } = decoder;
  if (decoder.pos >= arr.length) return null;

  // varUint length (7 bits per byte, little endian, high bit continues)
  let length = 0;
  let shift = 0;
  let pos = decoder.pos;
  for (;;) {
    if (pos >= arr.length) return null;
    const byte = arr[pos++];
    length += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) break;
    shift += 7;
    if (shift > 49) return null;
  }
  if (pos + length > arr.length) return null;
  const text = new TextDecoder().decode(arr.subarray(pos, pos + length));
  decoder.pos = pos + length;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Validate a type-20 payload.
 * @param value - Parsed JSON
 */
export function parseExternalChange(value: unknown): ExternalChangeMessage | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.state === 'resolved' && typeof v.byName === 'string') {
    return { state: 'resolved', byName: v.byName };
  }
  if (
    v.state === 'pending' &&
    typeof v.externalVersionId === 'string' &&
    typeof v.authorName === 'string' &&
    typeof v.at === 'string' &&
    typeof v.kind === 'string'
  ) {
    return {
      state: 'pending',
      externalVersionId: v.externalVersionId,
      authorName: v.authorName,
      at: v.at,
      kind: v.kind,
      ...(typeof v.restoredVersion === 'number' ? { restoredVersion: v.restoredVersion } : {}),
      ...(typeof v.draftAuthorName === 'string' ? { draftAuthorName: v.draftAuthorName } : {}),
      ...(typeof v.draftAt === 'string' ? { draftAt: v.draftAt } : {}),
    };
  }
  return null;
}

/**
 * Validate a type-21 payload.
 * @param value - Parsed JSON
 */
export function parseLock(value: unknown): LockMessage | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.locked !== 'boolean') return null;
  return { locked: v.locked, byName: typeof v.byName === 'string' ? v.byName : '' };
}
