import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const PEERS = Object.keys(pkg.peerDependencies ?? {});

const FILES = ['dist/index.js', 'dist/index.cjs'];
const DECLARATION_FILES = ['dist/index.d.ts', 'dist/index.d.cts'];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const leaks = [];
for (const file of FILES) {
  const code = readFileSync(file, 'utf8');
  for (const peer of PEERS) {
    const staticEsm = new RegExp(`from["']${escapeRegExp(peer)}["']`);
    const staticCjs = new RegExp(`require\\(["']${escapeRegExp(peer)}["']\\)`);
    if (staticEsm.test(code) || staticCjs.test(code)) {
      leaks.push(`${file}: ${peer}`);
    }
  }
}

const KNOWN_DECLARATION_LEAKS = new Set(['bullmq', 'knex']);

for (const file of DECLARATION_FILES) {
  const code = readFileSync(file, 'utf8');
  for (const peer of PEERS.filter((name) => !KNOWN_DECLARATION_LEAKS.has(name))) {
    const typeImport = new RegExp(`from ?["']${escapeRegExp(peer)}["']`);
    const inlineImport = new RegExp(`import\\(["']${escapeRegExp(peer)}["']\\)`);
    if (typeImport.test(code) || inlineImport.test(code)) {
      leaks.push(`${file}: ${peer} (type declaration)`);
    }
  }
}

if (leaks.length > 0) {
  console.error(`Optional peer statically bundled into the core entry:\n${leaks.join('\n')}`);
  process.exit(1);
}

console.log('core bundle and declarations clean: no optional peer is statically referenced');
