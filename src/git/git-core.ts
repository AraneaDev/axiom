import { execFile } from 'child_process';
import { promisify } from 'util';

import { AppError } from '../middleware/errorHandler';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

// ─── Validation Helpers ─────────────────────────────────────

const VALID_REF_RE = /^[a-zA-Z0-9._/~^@{}-]+$/;
const VALID_SHA_RE = /^[a-fA-F0-9]{4,40}$/;

/**
 * Validate a git ref name (branch, tag, etc.).
 * @param ref - The ref string to validate
 * @throws {AppError} 400 if the ref contains invalid characters
 */
export function validateRef(ref: string): void {
  if (!ref || !VALID_REF_RE.test(ref)) {
    throw new AppError(400, 'Invalid ref');
  }
}

/**
 * Validate a git SHA (full or abbreviated).
 * @param sha - The SHA string to validate
 * @throws {AppError} 400 if the SHA is not valid hex of 4-40 chars
 */
export function validateSha(sha: string): void {
  if (!sha || !VALID_SHA_RE.test(sha)) {
    throw new AppError(400, 'Invalid ref');
  }
}

export interface ExecOptions {
  cwd: string;
  maxBuffer?: number;
}

/**
 *
 * @param args
 * @param opts
 */
export async function git(args: string[], opts: ExecOptions): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: opts.cwd,
    maxBuffer: opts.maxBuffer ?? MAX_BUFFER,
  });
  return stdout;
}
