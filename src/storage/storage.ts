/**
 * Storage backend interface for file persistence.
 */
export interface StorageBackend {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

let instance: StorageBackend | null = null;

/**
 * Returns the configured storage backend singleton.
 */
export function getStorage(): StorageBackend {
  if (!instance) {
    // Lazy import to avoid circular deps
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LocalStorageBackend } = require('./local') as typeof import('./local');
    instance = new LocalStorageBackend();
  }
  return instance;
}
