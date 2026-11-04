import type { IncomingMessage } from 'http';

import { MemoryStore, type Options } from 'express-rate-limit';

import { AppError } from '../../middleware/errorHandler';
import { openPublicUrl, type PublicRequestDeps } from '../automation/webhook';

import {
  bareMimeType,
  isAllowedMimeType,
  MAX_ATTACHMENT_BYTES,
  mimeTypeRefusal,
} from './attachments.service';

const FETCH_TIMEOUT_MS = 10_000;

/** Fetches per user, as multipart uploads have per IP. */
export const FROM_URL_LIMIT = { windowMs: 60_000, max: 10 } as const;

/**
 * Fetches running at once, over all users. Each holds up to 25 MB in memory until it is stored, so
 * this keeps the total well under the container's memory limit.
 */
export const MAX_CONCURRENT_FETCHES = 4;

const fromUrlHits = new MemoryStore();
fromUrlHits.init({ windowMs: FROM_URL_LIMIT.windowMs } as Options);
let runningFetches = 0;

/**
 * Count a fetch against the user's limit.
 * @param userId - The user
 * @throws {AppError} 429 RATE_LIMITED past the limit
 */
export async function assertFetchWithinLimit(userId: string): Promise<void> {
  const { totalHits } = await fromUrlHits.increment(userId);
  if (totalHits > FROM_URL_LIMIT.max) {
    throw new AppError(429, 'Too many URL fetches, please try again later', 'RATE_LIMITED');
  }
}

/**
 * Run a fetch and the storing of its result in one of the limited slots.
 * @param work - The fetch and whatever holds on to its bytes
 * @throws {AppError} 429 RATE_LIMITED when every slot is taken: it doesn't wait, so a slow URL
 * can't build up a queue
 */
export async function withFetchSlot<T>(work: () => Promise<T>): Promise<T> {
  if (runningFetches >= MAX_CONCURRENT_FETCHES) {
    throw new AppError(429, 'Too many URL fetches, please try again later', 'RATE_LIMITED');
  }
  runningFetches++;
  try {
    return await work();
  } finally {
    runningFetches--;
  }
}

/** What fetchRemoteFile uses; tests replace the network. */
export interface RemoteFetchDeps extends PublicRequestDeps {
  /** For the whole fetch, redirects and reading included. */
  timeoutMs: number;
}

/**
 * Read a response up to the attachment limit, however little its Content-Length claimed.
 * @param res - The response
 * @throws {AppError} 413 past the limit
 */
async function readCapped(res: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res) {
    total += (chunk as Buffer).length;
    if (total > MAX_ATTACHMENT_BYTES) {
      res.destroy();
      throw new AppError(413, 'File is larger than 25 MB', 'FILE_TOO_LARGE');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Get a file over HTTPS for a user: every hop passes the SSRF guard, with the attachment limits on
 * size and type.
 * @param url - The URL
 * @param deps - Replaceable dependencies (tests)
 * @returns The bytes, and the bare type the server named
 * @throws {AppError} 400 for a refused URL, a failed answer or an empty file, 413, 415, 502 when
 * the connection fails or times out
 */
export async function fetchRemoteFile(
  url: string,
  deps: Partial<RemoteFetchDeps> = {},
): Promise<{ data: Buffer; mimeType: string }> {
  const signal = AbortSignal.timeout(deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    const res = await openPublicUrl(url, { signal }, 'Attachment', deps);
    try {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        throw new AppError(400, `The URL answered with status ${status}`, 'FETCH_FAILED');
      }
      const mimeType = bareMimeType(res.headers['content-type'] ?? '');
      if (!mimeType) throw new AppError(415, 'The URL did not name a file type');
      if (!isAllowedMimeType(mimeType)) throw mimeTypeRefusal(mimeType);
      if (Number(res.headers['content-length']) > MAX_ATTACHMENT_BYTES) {
        throw new AppError(413, 'File is larger than 25 MB', 'FILE_TOO_LARGE');
      }
      const data = await readCapped(res);
      if (data.length === 0) throw new AppError(400, 'The URL returned an empty file');
      return { data, mimeType };
    } finally {
      res.destroy();
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    // The cause stays here: it would tell a caller what the server can reach
    throw new AppError(502, 'Could not fetch the URL', 'FETCH_FAILED');
  }
}
