// Copies the Scalar bundle for /api/docs into dist, so production needs none of the packages
// behind it. @scalar/api-reference is a dev dependency, pinned exactly: this is the file it serves.
import { cpSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const source = path.join(path.dirname(require.resolve('@scalar/api-reference')), 'browser');
const target = path.join(import.meta.dirname, '..', 'dist', 'docs-assets');

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
