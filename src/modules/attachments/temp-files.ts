import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Readable } from 'stream';

import type { AppError } from '../../middleware/errorHandler';
import { isTempUploadPath, TEMP_UPLOAD_DIR } from '../../storage/temp-dir';

fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

/** A path for a new temp file. Nothing a client sent is part of it. */
export function newTempPath(): string {
  return path.join(TEMP_UPLOAD_DIR, crypto.randomUUID());
}

/**
 * Remove a temp file, if it is still there. A path outside the temp directory is left alone.
 * @param tempPath - Its path
 */
export async function removeTempFile(tempPath: string): Promise<void> {
  if (!isTempUploadPath(tempPath)) return;
  await fs.promises.unlink(tempPath).catch(() => {});
}

/** A file received in full, waiting to be stored. */
export interface TempFile {
  path: string;
  size: number;
}

/** How receiveToTempFile reads, and what it answers when it stops. */
export interface ReceiveOptions {
  /** The most it may hold */
  limit: number;
  /** How long it may take, however steadily the source keeps sending */
  timeoutMs: number;
  tooLarge: AppError;
  empty: AppError;
  /** The source went away before its end */
  interrupted: AppError;
  timedOut: AppError;
}

/**
 * Write a stream to a temp file with a byte count, refusing as soon as it can't succeed: past the
 * limit or the deadline, not at the end of a body that may never come. Only as much as the disk
 * takes in is read, so memory stays flat however many of these run. The temp file is gone after
 * any failure. The source stays open on a refusal, so that a request can still be answered.
 * @param source - The stream
 * @param options - The limits and the answers
 * @returns The file, which is now the caller's to store or remove
 */
export function receiveToTempFile(source: Readable, options: ReceiveOptions): Promise<TempFile> {
  return new Promise((resolve, reject) => {
    if (source.destroyed) {
      reject(options.interrupted);
      return;
    }
    const tempPath = newTempPath();
    const out = fs.createWriteStream(tempPath);
    let size = 0;
    let settled = false;

    const detach = () => {
      clearTimeout(timer);
      source.off('data', onData);
      source.off('end', onEnd);
      source.off('error', onGone);
      source.off('close', onGone);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      detach();
      source.pause();
      // Closed first: a stream still opening would create the file again after the unlink
      out.once('close', () => {
        void removeTempFile(tempPath).finally(() => reject(err));
      });
      out.destroy();
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.limit) {
        fail(options.tooLarge);
      } else if (!out.write(chunk)) {
        source.pause();
        out.once('drain', () => {
          if (!settled) source.resume();
        });
      }
    };
    const onEnd = () => {
      // All of it arrived: a source closing from here on means nothing
      source.off('close', onGone);
      if (size === 0) {
        fail(options.empty);
      } else {
        out.end();
      }
    };
    const onGone = () => fail(options.interrupted);
    const timer = setTimeout(() => fail(options.timedOut), options.timeoutMs);

    out.once('error', fail);
    out.once('finish', () => {
      if (settled) return;
      settled = true;
      detach();
      resolve({ path: tempPath, size });
    });
    source.on('data', onData);
    source.once('end', onEnd);
    source.once('error', onGone);
    source.once('close', onGone);
  });
}
