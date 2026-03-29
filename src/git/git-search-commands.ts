import { git } from './git-core';

export interface GrepResult {
  filePath: string;
  lineNumber: number;
  lineContent: string;
}

/**
 * Search file contents in a bare repository using git grep.
 * @param repoPath - path to the bare repository
 * @param query - search pattern (fixed string)
 * @param opts - optional file pattern glob and max results cap
 * @param opts.filePattern
 * @param opts.maxResults
 */
export async function grepFiles(
  repoPath: string,
  query: string,
  opts?: { filePattern?: string; maxResults?: number },
): Promise<GrepResult[]> {
  const limit = opts?.maxResults ?? 100;
  const args = ['grep', '-n', '--no-color', '-I', '-F', `--max-count=${limit}`];
  args.push(query, 'HEAD');
  if (opts?.filePattern) {
    args.push('--', opts.filePattern);
  }

  try {
    const output = await git(args, { cwd: repoPath });
    // Bare repo output format: HEAD:path/to/file:lineNum:content
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        // Strip leading "HEAD:" prefix from bare repo output
        const stripped = line.startsWith('HEAD:') ? line.slice(5) : line;
        const colonIdx1 = stripped.indexOf(':');
        const colonIdx2 = stripped.indexOf(':', colonIdx1 + 1);
        const filePath = stripped.slice(0, colonIdx1);
        const lineNumber = parseInt(stripped.slice(colonIdx1 + 1, colonIdx2), 10);
        const lineContent = stripped.slice(colonIdx2 + 1);
        return { filePath, lineNumber, lineContent };
      })
      .slice(0, limit);
  } catch {
    // git grep exits 1 when no matches found
    return [];
  }
}
