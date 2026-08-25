import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = process.cwd();
let consumerDirectory: string;
let packageArchiveDirectory: string;
let packageSpec: string;

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  return result;
}

async function createConsumer(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'payable-file-consumer-'));
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name: 'payable-file-consumer', private: true, type: 'module' }),
  );
  const install = run('bun', ['add', '--exact', packageSpec], directory);
  expect(install.status, install.stderr).toBe(0);
  return directory;
}

async function createPackageArchive(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'payable-package-'));
  const pack = run(
    'npm',
    ['pack', '--ignore-scripts', '--pack-destination', directory],
    packageRoot,
  );
  expect(pack.status, pack.stderr).toBe(0);
  const archiveName = pack.stdout.trim().split('\n').at(-1);
  expect(archiveName).toMatch(/\.tgz$/);
  packageArchiveDirectory = directory;
  return pathToFileURL(join(directory, archiveName as string)).href;
}

beforeAll(async () => {
  const build = run('bun', ['run', 'build'], packageRoot);
  expect(build.status, build.stderr).toBe(0);
  packageSpec = await createPackageArchive();
  consumerDirectory = await createConsumer();
}, 60_000);

afterAll(async () => {
  if (consumerDirectory) {
    await rm(consumerDirectory, { force: true, recursive: true });
  }
  if (packageArchiveDirectory) {
    await rm(packageArchiveDirectory, { force: true, recursive: true });
  }
});

describe('installed package tooling', () => {
  it('runs installed CLI help commands successfully', () => {
    for (const binary of ['payable-prisma', 'payable-mcp']) {
      const result = run(
        process.execPath,
        [join(consumerDirectory, 'node_modules', '.bin', binary), '--help'],
        consumerDirectory,
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('Usage:');
    }
  });

  it('typechecks and imports every installed package export', () => {
    const result = run(
      process.execPath,
      ['scripts/verify-package-consumer.mjs', packageSpec],
      packageRoot,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Package consumer verified');
  }, 60_000);

  it('copies the installed Prisma models to the requested consumer path', async () => {
    const outputPath = join(consumerDirectory, 'prisma', 'payable.models.prisma');
    const sync = run(
      process.execPath,
      [join(consumerDirectory, 'node_modules', '.bin', 'payable-prisma'), 'sync', outputPath],
      consumerDirectory,
    );

    expect(sync.status, sync.stderr).toBe(0);
    await expect(readFile(outputPath, 'utf8')).resolves.toContain('model PayableCustomer');
  });
});
