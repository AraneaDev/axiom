/**
 * Probe for single-yjs-tsx.test.ts: drives the collab server's sync path under tsx and
 * fails on any "Yjs was already imported" warning.
 */
import * as Y from 'yjs';

const warnings: string[] = [];
const original = console.warn;
console.warn = (...args: unknown[]) => {
  warnings.push(args.join(' '));
  original(...args);
};

async function main() {
  // The collab server's own loaders, so this tests the resolution it really uses.
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
  if (warnings.some((w) => w.includes('Yjs was already imported'))) {
    throw new Error('two yjs copies: ' + warnings.join('\n'));
  }
  process.stdout.write('probe-ok\n');
  process.exit(0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
