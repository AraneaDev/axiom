import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../..');
const GATE = 'modules/agent-approvals/agent-approvals.gate.ts';
const SERVICE = 'modules/agent-approvals/agent-approvals.service.ts';
const SELF = 'modules/agent-approvals/run-approved-import.test.ts';

/**
 * Every TypeScript file under a directory.
 * @param dir - Where to start
 * @returns Their paths
 */
function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : tsFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/**
 * The files of src, other than the gate itself, that name runApproved.
 * @returns Their paths relative to src
 */
function filesNamingRunApproved(): string[] {
  return tsFiles(SRC)
    .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
    .filter((rel) => rel !== GATE && rel !== SELF)
    .filter((rel) => /\brunApproved\b/.test(readFileSync(path.join(SRC, rel), 'utf8')))
    .sort();
}

describe('the bypass of the approval gate', () => {
  it('is entered only by the approval service', () => {
    expect(filesNamingRunApproved()).toEqual([SERVICE]);
  });
});
