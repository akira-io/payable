import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const LOCK_WAIT_MS = 25;
const LOCK_TIMEOUT_MS = 120_000;
const ORPHAN_LOCK_AGE_MS = 60_000;
const DEFAULT_SCHEMA = 'tests/prisma/schema.prisma';

export interface PrismaGenerateOptions {
  artifactsReady?: () => boolean;
  runGenerator?: (schema: string) => void;
  stateDirectory?: string;
}

export function prismaGenerateLockPath(stateDirectory = prismaGenerateStateDirectory()): string {
  return join(stateDirectory, 'generate.lock');
}

export function withPrismaGenerateLock<T>(work: () => T, stateDirectory?: string): T {
  const directory = stateDirectory ?? prismaGenerateStateDirectory();
  mkdirSync(directory, { recursive: true });
  const path = prismaGenerateLockPath(directory);
  const token = acquirePrismaGenerateLock(path);
  try {
    return work();
  } finally {
    releasePrismaGenerateLock(path, token);
  }
}

export function generatePrismaClient(
  schema = DEFAULT_SCHEMA,
  options: PrismaGenerateOptions = {},
): void {
  const stateDirectory = options.stateDirectory ?? prismaGenerateStateDirectory();
  withPrismaGenerateLock(() => {
    const fingerprint = prismaGenerateFingerprint(schema);
    const artifactsReady = options.artifactsReady ?? prismaGeneratedArtifactsReady;
    if (artifactsReady() && readPrismaGenerateStamp(stateDirectory) === fingerprint) return;
    const stamp = join(stateDirectory, 'generate.stamp');
    const temporaryStamp = `${stamp}.${randomUUID()}.tmp`;
    mkdirSync(stateDirectory, { recursive: true });
    rmSync(stamp, { force: true });
    try {
      (options.runGenerator ?? runPrismaGenerator)(schema);
      if (!artifactsReady()) throw new Error('Prisma generate did not produce a usable client');
      writeFileSync(temporaryStamp, fingerprint);
      renameSync(temporaryStamp, stamp);
    } finally {
      rmSync(temporaryStamp, { force: true });
    }
  }, stateDirectory);
}

function prismaGenerateStateDirectory(): string {
  return join(process.cwd(), 'node_modules', '.payable-prisma-test-generate');
}

function runPrismaGenerator(schema: string): void {
  execFileSync('npx', ['prisma', 'generate', '--schema', schema], { stdio: 'ignore' });
}

function prismaGenerateFingerprint(schema: string): string {
  return createHash('sha256')
    .update(readFileSync(schema))
    .update(prismaPackageVersion('prisma'))
    .update(prismaPackageVersion('@prisma/client'))
    .digest('hex');
}

function prismaPackageVersion(packageName: string): string {
  const packagePath = join(process.cwd(), 'node_modules', packageName, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string };
  if (!packageJson.version) throw new Error(`Missing version in ${packageName}/package.json`);
  return packageJson.version;
}

function prismaGeneratedArtifactsReady(): boolean {
  const generatedClient = join(process.cwd(), 'node_modules', '.prisma', 'client');
  return (
    existsSync(join(generatedClient, 'index.js')) &&
    readdirSync(generatedClient).some((entry) => entry.includes('query_engine'))
  );
}

function readPrismaGenerateStamp(stateDirectory: string): string | null {
  try {
    return readFileSync(join(stateDirectory, 'generate.stamp'), 'utf8');
  } catch {
    return null;
  }
}

function acquirePrismaGenerateLock(path: string): string {
  const token = randomUUID();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      mkdirSync(path);
      writeFileSync(`${path}/owner.json`, JSON.stringify({ pid: process.pid, token }));
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      reclaimStalePrismaGenerateLock(path);
      if (Date.now() >= deadline)
        throw new Error('Timed out waiting for the Prisma generate test lock');
      waitForPrismaGenerateLock();
    }
  }
}

function reclaimStalePrismaGenerateLock(path: string): void {
  const owner = readPrismaGenerateLockOwner(path);
  if (owner?.pid !== undefined && isPrismaGenerateLockProcessAlive(owner.pid)) return;
  if (owner?.pid !== undefined) {
    removePrismaGenerateLock(path);
    return;
  }
  try {
    if (Date.now() - statSync(path).mtimeMs >= ORPHAN_LOCK_AGE_MS) removePrismaGenerateLock(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function removePrismaGenerateLock(path: string): void {
  const stalePath = `${path}.${randomUUID()}.stale`;
  try {
    renameSync(path, stalePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  rmSync(stalePath, { force: true, recursive: true });
}

function releasePrismaGenerateLock(path: string, token: string): void {
  if (readPrismaGenerateLockOwner(path)?.token === token)
    rmSync(path, { force: true, recursive: true });
}

function readPrismaGenerateLockOwner(path: string): { pid?: number; token?: string } | null {
  try {
    return JSON.parse(readFileSync(`${path}/owner.json`, 'utf8')) as {
      pid?: number;
      token?: string;
    };
  } catch {
    return null;
  }
}

export function isPrismaGenerateLockProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    throw error;
  }
}

function waitForPrismaGenerateLock(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_WAIT_MS);
}
