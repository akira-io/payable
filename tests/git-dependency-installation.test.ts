import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = process.cwd();
let fixtureRoot: string;
let archiveRoot: string;
let consumerRoot: string;

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  expect(result.error).toBeUndefined();
  return result;
}

async function packSourceWithoutPrebuild(): Promise<string> {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'payable-source-package-'));
  for (const path of [
    'package.json',
    'bun.lock',
    'tsconfig.json',
    'tsup.config.ts',
    'scripts/prepare-package.mjs',
    'src',
    'prisma',
  ]) {
    await cp(join(packageRoot, path), join(fixtureRoot, path), { recursive: true });
  }
  const binaryDirectory = join(fixtureRoot, 'node_modules', '.bin');
  const ambientTsup = join(binaryDirectory, 'tsup');
  await mkdir(binaryDirectory, { recursive: true });
  await writeFile(
    ambientTsup,
    `#!/bin/sh
mkdir -p dist/express dist/fastify dist/mcp dist/nest dist/prisma dist/sisp
printf "export const fixture = true;\\n" > dist/index.js
printf "exports.fixture = true;\\n" > dist/index.cjs
printf "export * from './domain/contracts';\\n" > dist/index.d.ts
printf "export * from './domain/contracts';\\n" > dist/index.d.cts
for subpath in express fastify mcp nest prisma sisp; do
  printf "export const fixture = true;\\n" > "dist/$subpath/index.js"
  printf "exports.fixture = true;\\n" > "dist/$subpath/index.cjs"
  printf "export {};\\n" > "dist/$subpath/index.d.ts"
  printf "export {};\\n" > "dist/$subpath/index.d.cts"
done
`,
  );
  await chmod(ambientTsup, 0o755);
  archiveRoot = await mkdtemp(join(tmpdir(), 'payable-source-archive-'));
  const pack = run('npm', ['pack', '--pack-destination', archiveRoot], fixtureRoot);
  expect(pack.status, pack.stderr).toBe(0);
  const archiveName = pack.stdout.trim().split('\n').at(-1);
  expect(archiveName).toMatch(/\.tgz$/);
  return join(archiveRoot, archiveName as string);
}

async function installConsumerPeers(): Promise<void> {
  const installedPackageJson = JSON.parse(
    await readFile(
      join(consumerRoot, 'node_modules', '@akira-io', 'payable', 'package.json'),
      'utf8',
    ),
  );
  const peerNames = Object.keys(installedPackageJson.peerDependencies);
  const peers = await Promise.all(
    peerNames.map(async (name) => {
      const peerPackageJson = JSON.parse(
        await readFile(join(packageRoot, 'node_modules', name, 'package.json'), 'utf8'),
      );
      return `${name}@${peerPackageJson.version}`;
    }),
  );
  const nodeTypesPackageJson = JSON.parse(
    await readFile(join(packageRoot, 'node_modules', '@types', 'node', 'package.json'), 'utf8'),
  );
  const install = run(
    'bun',
    ['add', '--dev', `@types/node@${nodeTypesPackageJson.version}`, ...peers],
    consumerRoot,
  );
  expect(install.status, install.stderr).toBe(0);
}

beforeAll(async () => {
  const packageSpec = process.env.PAYABLE_GIT_INSTALL_SPEC ?? (await packSourceWithoutPrebuild());
  consumerRoot = await mkdtemp(join(tmpdir(), 'payable-source-consumer-'));
  await writeFile(
    join(consumerRoot, 'package.json'),
    JSON.stringify({ name: 'payable-source-consumer', private: true, type: 'module' }),
  );

  const install = run('bun', ['add', '--trust', '--exact', packageSpec], consumerRoot);
  expect(install.status, install.stderr).toBe(0);
  await installConsumerPeers();
  await Promise.all([
    writeFile(
      join(consumerRoot, 'consumer.ts'),
      `import type { Payment, PaymentProvider, PriceDTO, Subscription } from '@akira-io/payable';

declare const payment: Payment;
declare const provider: PaymentProvider;
declare const price: PriceDTO;
declare const subscription: Subscription;
void [payment, provider, price, subscription];
`,
    ),
    writeFile(
      join(consumerRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          strict: true,
        },
        include: ['consumer.ts'],
      }),
    ),
  ]);
}, 120_000);

afterAll(async () => {
  await Promise.all(
    [fixtureRoot, archiveRoot, consumerRoot]
      .filter((path): path is string => Boolean(path))
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('source dependency preparation', () => {
  it('typechecks representative API exports under NodeNext', () => {
    const typecheck = run(
      join(packageRoot, 'node_modules', '.bin', 'tsc'),
      ['--project', 'tsconfig.json'],
      consumerRoot,
    );

    expect(typecheck.status, typecheck.stderr || typecheck.stdout).toBe(0);
  });

  it('loads every package subpath under ESM and CJS without a prebuilt dist', () => {
    const specifiers = [
      '@akira-io/payable',
      '@akira-io/payable/express',
      '@akira-io/payable/fastify',
      '@akira-io/payable/mcp',
      '@akira-io/payable/nest',
      '@akira-io/payable/prisma',
      '@akira-io/payable/sisp',
    ];
    const loadEsm = run(
      'node',
      [
        '--input-type=module',
        '--eval',
        `await Promise.all(${JSON.stringify(specifiers)}.map((specifier) => import(specifier)));`,
      ],
      consumerRoot,
    );
    const loadCjs = run(
      'node',
      [
        '--input-type=commonjs',
        '--eval',
        `for (const specifier of ${JSON.stringify(specifiers)}) require(specifier);`,
      ],
      consumerRoot,
    );

    expect(loadEsm.status, loadEsm.stderr).toBe(0);
    expect(loadCjs.status, loadCjs.stderr).toBe(0);
  });
});
