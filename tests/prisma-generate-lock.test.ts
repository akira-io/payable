import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  generatePrismaClient,
  isPrismaGenerateLockProcessAlive,
  prismaGenerateLockPath,
  withPrismaGenerateLock,
} from './support/prisma-generate';

const isWorker = process.env.PAYABLE_PRISMA_LOCK_WORKER === '1';

describe.skipIf(isWorker)('Prisma generate lock', () => {
  it('recovers a lock left by a dead process and releases its own lock', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'payable-prisma-lock-'));
    const stateDirectory = join(fixture, 'state');
    const path = prismaGenerateLockPath(stateDirectory);
    mkdirSync(path, { recursive: true });
    writeFileSync(`${path}/owner.json`, JSON.stringify({ pid: 2147483647, token: 'orphan' }));
    let ran = false;

    withPrismaGenerateLock(() => {
      ran = true;
    }, stateDirectory);

    expect(ran).toBe(true);
    expect(existsSync(path)).toBe(false);
    rmSync(fixture, { force: true, recursive: true });
  });

  it('skips a second generator run for the same fingerprint and regenerates after a schema change', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'payable-prisma-lock-'));
    const schema = join(fixture, 'schema.prisma');
    const stateDirectory = join(fixture, 'state');
    writeFileSync(schema, 'generator client { provider = "prisma-client-js" }');
    const runGenerator = vi.fn();
    const options = { artifactsReady: () => true, runGenerator, stateDirectory };

    generatePrismaClient(schema, options);
    generatePrismaClient(schema, options);
    writeFileSync(
      schema,
      'generator client { provider = "prisma-client-js" binaryTargets = ["native"] }',
    );
    generatePrismaClient(schema, options);

    expect(runGenerator).toHaveBeenCalledTimes(2);
    rmSync(fixture, { force: true, recursive: true });
  });

  it('removes an invalidated stamp when generation fails before publishing a replacement', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'payable-prisma-lock-'));
    const schema = join(fixture, 'schema.prisma');
    const stateDirectory = join(fixture, 'state');
    writeFileSync(schema, 'generator client { provider = "prisma-client-js" }');
    generatePrismaClient(schema, {
      artifactsReady: () => true,
      runGenerator: vi.fn(),
      stateDirectory,
    });
    writeFileSync(
      schema,
      'generator client { provider = "prisma-client-js" binaryTargets = ["native"] }',
    );

    expect(() =>
      generatePrismaClient(schema, {
        artifactsReady: () => true,
        runGenerator: () => {
          throw new Error('generator failed');
        },
        stateDirectory,
      }),
    ).toThrow('generator failed');
    expect(existsSync(join(stateDirectory, 'generate.stamp'))).toBe(false);
    rmSync(fixture, { force: true, recursive: true });
  });

  it('treats permission denial as an active owner and propagates unexpected process errors', () => {
    const kill = vi.spyOn(process, 'kill');
    kill.mockImplementation((() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    }) as typeof process.kill);
    expect(isPrismaGenerateLockProcessAlive(42)).toBe(false);
    kill.mockImplementation((() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' });
    }) as typeof process.kill);
    expect(isPrismaGenerateLockProcessAlive(42)).toBe(true);
    kill.mockImplementation((() => {
      throw Object.assign(new Error('unexpected'), { code: 'EIO' });
    }) as typeof process.kill);
    expect(() => isPrismaGenerateLockProcessAlive(42)).toThrow('unexpected');
  });

  it('runs the generator once across two real processes sharing a fingerprint', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'payable-prisma-lock-'));
    const schema = join(fixture, 'schema.prisma');
    const stateDirectory = join(fixture, 'state');
    const log = join(fixture, 'generator.log');
    writeFileSync(schema, 'generator client { provider = "prisma-client-js" }');
    const first = lockWorker({ holdMs: '400', log, schema, stateDirectory, worker: 'first' });
    await waitFor(() => existsSync(log));
    const second = lockWorker({ holdMs: '0', log, schema, stateDirectory, worker: 'second' });
    await Promise.all([first, second]);

    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['first']);
    rmSync(fixture, { force: true, recursive: true });
  }, 15_000);
});

describe.skipIf(!isWorker)('Prisma generate lock worker', () => {
  it('runs its injected generator', () => {
    const schema = requiredEnv('PAYABLE_PRISMA_LOCK_SCHEMA');
    const stateDirectory = requiredEnv('PAYABLE_PRISMA_LOCK_STATE');
    const log = requiredEnv('PAYABLE_PRISMA_LOCK_LOG');
    const worker = requiredEnv('PAYABLE_PRISMA_LOCK_WORKER_NAME');
    const holdMs = Number(requiredEnv('PAYABLE_PRISMA_LOCK_HOLD_MS'));

    generatePrismaClient(schema, {
      artifactsReady: () => true,
      runGenerator: () => {
        appendFileSync(log, `${worker}\n`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);
      },
      stateDirectory,
    });
  });
});

interface LockWorkerOptions {
  holdMs: string;
  log: string;
  schema: string;
  stateDirectory: string;
  worker: string;
}

function lockWorker(values: LockWorkerOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', fileURLToPath(import.meta.url)],
      {
        cwd: process.cwd(),
        env: { ...process.env, PAYABLE_PRISMA_LOCK_WORKER: '1', ...workerEnvironment(values) },
        stdio: 'ignore',
      },
    );
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)),
    );
  });
}

function workerEnvironment(values: LockWorkerOptions): Record<string, string> {
  return {
    PAYABLE_PRISMA_LOCK_HOLD_MS: values.holdMs,
    PAYABLE_PRISMA_LOCK_LOG: values.log,
    PAYABLE_PRISMA_LOCK_SCHEMA: values.schema,
    PAYABLE_PRISMA_LOCK_STATE: values.stateDirectory,
    PAYABLE_PRISMA_LOCK_WORKER_NAME: values.worker,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Prisma lock worker');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
