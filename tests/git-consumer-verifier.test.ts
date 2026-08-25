import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = process.cwd();
const packageSpec = pathToFileURL(packageRoot).href;
let consumerDirectory: string;

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

beforeAll(async () => {
  const build = run('bun', ['run', 'build'], packageRoot);
  expect(build.status, build.stderr).toBe(0);
  consumerDirectory = await createConsumer();
}, 60_000);

afterAll(async () => {
  if (consumerDirectory) {
    await rm(consumerDirectory, { force: true, recursive: true });
  }
});

describe('installed Git-consumer tooling', () => {
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

  it('verifies the installed Prisma asset through the consumer verifier', () => {
    const result = run(
      process.execPath,
      ['scripts/verify-git-consumer.mjs', packageSpec],
      packageRoot,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Prisma asset verified');
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
