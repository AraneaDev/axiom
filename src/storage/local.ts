import fs from 'fs/promises';
import path from 'path';

import type { StorageBackend } from './storage';

const DEFAULT_BASE_PATH = '.data/uploads';

/**
 * Local filesystem storage backend.
 * Stores files at {basePath}/{key}, creating directories as needed.
 */
export class LocalStorageBackend implements StorageBackend {
  private basePath: string;

  constructor() {
    this.basePath = process.env.STORAGE_PATH || DEFAULT_BASE_PATH;
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const filePath = this.resolve(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async get(key: string): Promise<Buffer> {
    const filePath = this.resolve(key);
    return fs.readFile(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolve(key);
    await fs.unlink(filePath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolve(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private resolve(key: string): string {
    // Prevent directory traversal
    const normalized = path.normalize(key).replace(/^(\.\.[/\\])+/, '');
    return path.join(this.basePath, normalized);
  }
}
