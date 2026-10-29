/**
 * Probe for single-yjs-tsx.test.ts: loads yjs and the collab server's y-protocols and
 * lib0 the way the server does, under tsx, and fails when a second copy of yjs appears.
 *
 * A second copy is detected two ways, because a mixed-copy sync round trip can still
 * "work": yjs logs "Yjs was already imported" through console.error when it loads twice
 * (hooked before anything is loaded), and no ESM build (yjs.mjs) may be in the module cache,
 * with at most one yjs entry.
 */
import { createRequire } from 'module';

const reports: string[] = [];
/* eslint-disable no-console -- the hook must wrap console.warn/error by computed name to catch yjs's duplicate-import report, then pass the call through */
for (const method of ['warn', 'error'] as const) {
  const original = console[method];
  console[method] = (...args: unknown[]) => {
    reports.push(args.map(String).join(' '));
    original(...args);
  };
}
/* eslint-enable no-console */

const load = createRequire(__filename);

async function main() {
  const Y = load('yjs') as typeof import('yjs');
  const collab = await import('../realtime/collaboration');
  const server = collab.__protocolsForProbe();
  const [sync, awareness, enc, dec] = await Promise.all([
    server.sync(),
    server.awareness(),
    server.encoding(),
    server.decoding(),
  ]);

  const a = new Y.Doc();
  const b = new Y.Doc();
  a.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')]);
  new awareness.Awareness(a).destroy();
  const e = enc.createEncoder();
  sync.writeSyncStep2(e, a);
  sync.readSyncMessage(dec.createDecoder(enc.toUint8Array(e)), enc.createEncoder(), b, null);
  if (b.getXmlFragment('default').length !== 1) throw new Error('sync did not apply');

  const duplicate = reports.filter((r) => r.includes('Yjs was already imported'));
  if (duplicate.length > 0) throw new Error('two yjs copies (reported by yjs): ' + duplicate[0]);

  const yjsModules = Object.keys(load.cache).filter((f) =>
    /[\\/]node_modules[\\/]yjs[\\/]dist[\\/]/.test(f),
  );
  const esm = yjsModules.filter((f) => f.endsWith('.mjs'));
  if (esm.length > 0 || yjsModules.length !== 1) {
    throw new Error('two yjs copies (module cache): ' + yjsModules.join(', '));
  }

  process.stdout.write('probe-ok\n');
  process.exit(0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
