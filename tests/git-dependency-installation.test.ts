import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  archiveRoot = await mkdtemp(join(tmpdir(), 'payable-source-archive-'));
  const pack = run('npm', ['pack', '--pack-destination', archiveRoot], fixtureRoot);
  expect(pack.status, pack.stderr).toBe(0);
  const archiveName = pack.stdout.trim().split('\n').at(-1);
  expect(archiveName).toMatch(/\.tgz$/);
  return join(archiveRoot, archiveName as string);
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
}, 120_000);

afterAll(async () => {
  await Promise.all(
    [fixtureRoot, archiveRoot, consumerRoot]
      .filter((path): path is string => Boolean(path))
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('source dependency preparation', () => {
  it('builds and loads the root, Prisma, and SISP exports without a prebuilt dist', () => {
    const loadExports = run(
      'node',
      [
        '--input-type=module',
        '--eval',
        "await Promise.all([import('@akira-io/payable'), import('@akira-io/payable/prisma'), import('@akira-io/payable/sisp')]);",
      ],
      consumerRoot,
    );

    expect(loadExports.status, loadExports.stderr).toBe(0);
  });
});
