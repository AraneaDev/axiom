import path from 'path';

/** Where uploads wait on disk until they are stored. */
export const TEMP_UPLOAD_DIR = '/tmp/uploads';

/**
 * Whether a path names a file directly in the temp upload directory, once resolved. Moving or
 * deleting a file on the strength of a path should only ever touch those.
 * @param filePath - The path
 */
export function isTempUploadPath(filePath: string): boolean {
  return path.dirname(path.resolve(filePath)) === TEMP_UPLOAD_DIR;
}
