import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const sourcePackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const workspace = mkdtempSync(join(tmpdir(), 'payable-consumer-'));
const packJson = execFileSync('npm', ['pack', '--json', '--pack-destination', workspace], {
  cwd: root,
  encoding: 'utf8',
});
const [{ filename, files }] = JSON.parse(packJson);
const paths = new Set(files.map((file) => file.path));
for (const required of [
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'prisma/schema.prisma',
]) {
  if (!paths.has(required)) throw new Error(`Packed artifact is missing ${required}`);
}
if ([...paths].some((path) => /^(tests|coverage)\//.test(path) || /(?:^|\/)\.env/.test(path))) {
  throw new Error('Packed artifact contains private test, coverage, or environment files');
}

writeFileSync(
  join(workspace, 'package.json'),
  JSON.stringify({
    private: true,
    type: 'module',
    dependencies: {
      '@akira-io/payable': `file:./${filename}`,
      ...Object.fromEntries(
        Object.keys(sourcePackage.peerDependencies).map((name) => [
          name,
          sourcePackage.devDependencies[name],
        ]),
      ),
    },
    devDependencies: { '@types/node': sourcePackage.devDependencies['@types/node'] },
  }),
);
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: workspace });

const subpaths = ['/express', '/fastify', '/nest', '/mcp', '/sisp', '/prisma'];
writeFileSync(
  join(workspace, 'esm.mjs'),
  `await import('@akira-io/payable');\n${subpaths.map((path) => `await import('@akira-io/payable${path}');`).join('\n')}\n`,
);
writeFileSync(
  join(workspace, 'cjs.cjs'),
  `require('@akira-io/payable');\n${subpaths.map((path) => `require('@akira-io/payable${path}');`).join('\n')}\n`,
);
writeFileSync(
  join(workspace, 'types.ts'),
  "import { createPayable } from '@akira-io/payable';\nvoid createPayable;\n",
);
writeFileSync(
  join(workspace, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      types: ['node'],
      noEmit: true,
    },
  }),
);

execFileSync('node', ['esm.mjs'], { cwd: workspace, stdio: 'inherit' });
execFileSync('node', ['cjs.cjs'], { cwd: workspace, stdio: 'inherit' });
execFileSync(join(root.pathname, 'node_modules/.bin/tsc'), ['--noEmit', '-p', 'tsconfig.json'], {
  cwd: workspace,
  stdio: 'inherit',
});

const installed = JSON.parse(
  readFileSync(join(workspace, 'node_modules/@akira-io/payable/package.json'), 'utf8'),
);
for (const name of ['payable-mcp', 'payable-prisma']) {
  if (!installed.bin?.[name] || !paths.has(installed.bin[name].replace(/^\.\//, ''))) {
    throw new Error(`Packed artifact is missing the ${name} bin`);
  }
}
console.log('packed consumer verified: ESM, CJS, types, subpaths, bins, and contents');
