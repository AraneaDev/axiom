/**
 * Storage backend interface for file persistence.
 */
export interface StorageBackend {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /**
   * Store a file from disk without reading it into memory. The file at tempPath may be gone
   * afterwards.
   */
  putFile(key: string, tempPath: string, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

import { LocalStorageBackend } from './local';

let instance: StorageBackend | null = null;

/**
 * Returns the configured storage backend singleton.
 */
export function getStorage(): StorageBackend {
  if (!instance) {
    // local.ts only imports a type from here, so a static import makes no cycle; the
    // require() it replaced failed to resolve under the test runner
    instance = new LocalStorageBackend();
  }
  return instance;
}
