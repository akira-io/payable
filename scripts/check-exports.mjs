import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

const problems = [];

for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
  for (const condition of ['types', 'import', 'require']) {
    const rel = entry[condition];
    if (!rel) {
      problems.push(`${subpath}: missing "${condition}" condition`);
      continue;
    }
    if (!existsSync(fileURLToPath(new URL(rel, root)))) {
      problems.push(`${subpath}: ${condition} -> ${rel} does not exist`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Broken exports map:\n${problems.join('\n')}`);
  process.exit(1);
}

const core = pkg.exports['.'];
const esm = await import(new URL(core.import, root).href);
if (typeof esm.createPayable !== 'function') {
  console.error('ESM core entry does not export createPayable');
  process.exit(1);
}

const cjs = require(fileURLToPath(new URL(core.require, root)));
if (typeof cjs.createPayable !== 'function') {
  console.error('CJS core entry does not export createPayable');
  process.exit(1);
}

console.log('exports verified: subpath files exist; core entry imports under ESM and CJS');
