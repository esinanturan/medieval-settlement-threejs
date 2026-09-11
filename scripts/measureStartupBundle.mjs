import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Read-only source overlay: compare an earlier revision using today's installed
// toolchain/assets without checking out files or interrupting ongoing edits.
const ref = process.argv.find(arg => arg.startsWith('--ref='))?.slice(6);
const originals = new Map();
if (ref) {
  const commit = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
  const changed = execFileSync('git', ['diff', '--name-only', commit], { encoding: 'utf8' }).trim().split(/\r?\n/);
  for (const name of changed.filter(name => /\.[jt]s$/.test(name))) {
    try {
      originals.set(path.resolve(name).replaceAll('\\', '/'), execFileSync('git', ['show', `${commit}:${name}`], {
        encoding: 'utf8', maxBuffer: 8_000_000, stdio: ['ignore', 'pipe', 'pipe'],
      }));
    } catch {
      // Newly added modules are unreachable from the original import graph.
    }
  }
}
const overlaid = [];
const result = await build({
  logLevel: 'silent', build: { write: false },
  plugins: [{
    name: 'startup-reference-source', enforce: 'pre',
    load(id) {
      if (!originals.has(id)) return null;
      overlaid.push(id); return originals.get(id);
    },
  }],
});
const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output).filter(item => item.type === 'chunk');
const entry = chunks.find(chunk => chunk.isEntry);
if (!entry) throw Error('No application entry found');
const byName = new Map(chunks.map(chunk => [chunk.fileName, chunk])), closure = new Set();
function visit(chunk) {
  if (closure.has(chunk)) return;
  closure.add(chunk);
  for (const name of chunk.imports) if (byName.has(name)) visit(byName.get(name));
}
visit(entry);
console.log(JSON.stringify({
  ref: ref ?? 'working tree',
  entryBytes: Buffer.byteLength(entry.code), entryGzipBytes: gzipSync(entry.code).length,
  closureBytes: [...closure].reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0),
  closureGzipBytes: [...closure].reduce((sum, chunk) => sum + gzipSync(chunk.code).length, 0),
  overlaid,
}, null, 2));
