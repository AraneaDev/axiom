import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { convertMarkdown } from './pandoc';

// A stand-in pandoc on PATH that prints the names of the environment it was given
const FAKE_PANDOC = `#!${process.execPath}
process.stdin.resume();
process.stdin.on('end', () => process.stdout.write(JSON.stringify(Object.keys(process.env))));
`;

class CapturedResponse extends Writable {
  body = '';
  headers: Record<string, string> = {};
  statusCode = 200;
  headersSent = false;

  _write(chunk: Buffer, _encoding: string, done: () => void) {
    this.body += chunk.toString();
    done();
  }

  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(payload: unknown) {
    this.body = JSON.stringify(payload);
    this.headersSent = true;
    return this;
  }
}

describe('pandoc', () => {
  const originalPath = process.env.PATH;
  let binDir = '';

  beforeEach(async () => {
    binDir = await mkdtemp(join(tmpdir(), 'fake-pandoc-'));
    await writeFile(join(binDir, 'pandoc'), FAKE_PANDOC);
    await chmod(join(binDir, 'pandoc'), 0o755);
    process.env.PATH = `${binDir}:${originalPath}`;
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    await rm(binDir, { recursive: true, force: true });
  });

  it('runs pandoc with PATH, HOME and LANG only, never the instance secrets', async () => {
    expect(process.env.AXIOM_ENCRYPTION_KEY).toBeDefined();
    expect(process.env.JWT_SECRET).toBeDefined();
    const res = new CapturedResponse();

    await convertMarkdown('# Notes', 'Notes', 'plain', res as unknown as Response);

    const names = JSON.parse(res.body) as string[];
    expect(res.statusCode).toBe(200);
    expect(names).toContain('PATH');
    for (const name of names) expect(['PATH', 'HOME', 'LANG']).toContain(name);
  });
});
