import fs from 'fs/promises';
import path from 'path';

import { prisma } from '../config/database';
import { logger } from '../utils/logger';

import { installPostReceiveHook } from './repo-manager';

/**
 * Rewrite the post-receive hook of every repository that exists on disk.
 * Runs on every deploy from the migrate entry point. Idempotent.
 * @returns Counts of rewritten and skipped repositories
 */
export async function reinstallAllHooks(): Promise<{ installed: number; skipped: number }> {
  const repos = await prisma.repository.findMany({
    where: { diskPath: { not: null } },
    select: { id: true, diskPath: true },
  });

  let installed = 0;
  let skipped = 0;
  for (const repo of repos) {
    const diskPath = repo.diskPath!;
    try {
      await fs.access(path.join(diskPath, 'HEAD'));
    } catch {
      skipped++;
      logger.warn('Skipping hook install, repository missing on disk', { repoId: repo.id });
      continue;
    }
    await installPostReceiveHook(diskPath, repo.id);
    installed++;
  }
  return { installed, skipped };
}
