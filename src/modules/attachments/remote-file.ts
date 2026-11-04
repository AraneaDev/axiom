import { MemoryStore, type Options } from 'express-rate-limit';

import { AppError } from '../../middleware/errorHandler';
import { openPublicUrl, type PublicRequestDeps } from '../automation/webhook';

import {
  bareMimeType,
  isAllowedMimeType,
  MAX_ATTACHMENT_BYTES,
  mimeTypeRefusal,
} from './attachments.service';
import { createUserSlots, receiveToTempFile, type TempFile } from './temp-files';

const FETCH_TIMEOUT_MS = 10_000;

/** Fetches per user, as multipart uploads have per IP. */
export const FROM_URL_LIMIT = { windowMs: 60_000, max: 10 } as const;

/** Fetches running at once, per user and over all users: each holds a connection and a file. */
export const MAX_CONCURRENT_FETCHES = 4;
export const MAX_CONCURRENT_FETCHES_PER_USER = 2;

const fetchSlots = createUserSlots(MAX_CONCURRENT_FETCHES_PER_USER, MAX_CONCURRENT_FETCHES);

const fromUrlHits = new MemoryStore();
fromUrlHits.init({ windowMs: FROM_URL_LIMIT.windowMs } as Options);

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
 * @param userId - The user
 * @param work - The fetch and whatever comes with it
 * @throws {AppError} 429 RATE_LIMITED when no slot is free: it doesn't wait, so a slow URL can't
 * build up a queue
 */
export function withFetchSlot<T>(userId: string, work: () => Promise<T>): Promise<T> {
  return fetchSlots.run(
    userId,
    new AppError(429, 'Too many URL fetches, please try again later', 'RATE_LIMITED'),
    work,
  );
}

/** What fetchRemoteFile uses; tests replace the network. */
export interface RemoteFetchDeps extends PublicRequestDeps {
  /** For the whole fetch, redirects and reading included. */
  timeoutMs: number;
}

/**
 * Get a file over HTTPS for a user: every hop passes the SSRF guard, with the attachment limits on
 * size and type.
 * @param url - The URL
 * @param deps - Replaceable dependencies (tests)
 * @returns A temp file with the bytes, and the bare type the server named
 * @throws {AppError} 400 for a refused URL, a failed answer or an empty file, 413, 415, 502 when
 * the connection fails or times out
 */
export async function fetchRemoteFile(
  url: string,
  deps: Partial<RemoteFetchDeps> = {},
): Promise<TempFile & { mimeType: string }> {
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
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
      const couldNotFetch = new AppError(502, 'Could not fetch the URL', 'FETCH_FAILED');
      const file = await receiveToTempFile(res, {
        limit: MAX_ATTACHMENT_BYTES,
        timeoutMs,
        tooLarge: new AppError(413, 'File is larger than 25 MB', 'FILE_TOO_LARGE'),
        empty: new AppError(400, 'The URL returned an empty file'),
        interrupted: couldNotFetch,
        timedOut: couldNotFetch,
      });
      return { ...file, mimeType };
    } finally {
      res.destroy();
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    // The cause stays here: it would tell a caller what the server can reach
    throw new AppError(502, 'Could not fetch the URL', 'FETCH_FAILED');
  }
}
