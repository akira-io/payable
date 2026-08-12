import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tag = process.argv[2];
const root = resolve(process.argv[3] ?? '.');
const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?)$/.exec(tag ?? '');

if (!match) {
  console.error('Release tag must be a canonical v-prefixed semantic version');
  process.exit(1);
}

const version = match[1];
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
const heading = `## [${version}](`;
const releaseLine = changelog.split('\n').find((line) => line.startsWith(heading));

if (pkg.version !== version) {
  console.error(`Tag ${tag} does not match package version ${pkg.version}`);
  process.exit(1);
}
if (!releaseLine?.includes('/compare/') || !releaseLine.endsWith(`...v${version})`)) {
  console.error(`CHANGELOG.md has no compare-linked release section for ${version}`);
  process.exit(1);
}

console.log(`release metadata verified for ${tag}`);
