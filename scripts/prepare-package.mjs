import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runCommand(command, commandArguments, options = {}) {
  const execution = spawnSync(command, commandArguments, { stdio: 'inherit', ...options });
  if (execution.error) throw execution.error;
  if (execution.status !== 0) throw new Error(`${command} exited with status ${execution.status}`);
}

const toolchainRoot = mkdtempSync(join(tmpdir(), 'payable-build-toolchain-'));
const stagedDist = `.payable-dist-${process.pid}`;
const previousDist = `.payable-dist-previous-${process.pid}`;

try {
  copyFileSync('package.json', join(toolchainRoot, 'package.json'));
  copyFileSync('bun.lock', join(toolchainRoot, 'bun.lock'));
  copyFileSync('tsconfig.json', join(toolchainRoot, 'tsconfig.json'));
  copyFileSync('tsup.config.ts', join(toolchainRoot, 'tsup.config.ts'));
  cpSync('src', join(toolchainRoot, 'src'), { recursive: true });
  cpSync('prisma', join(toolchainRoot, 'prisma'), { recursive: true });
  runCommand('bun', [
    'install',
    '--cwd',
    toolchainRoot,
    '--backend=copyfile',
    '--frozen-lockfile',
    '--ignore-scripts',
  ]);
  runCommand(process.execPath, ['node_modules/tsup/dist/cli-default.js'], {
    cwd: toolchainRoot,
  });
  cpSync(join(toolchainRoot, 'dist'), stagedDist, { recursive: true });
  const hasPreviousDist = existsSync('dist');
  if (hasPreviousDist) renameSync('dist', previousDist);
  try {
    renameSync(stagedDist, 'dist');
    rmSync(previousDist, { force: true, recursive: true });
  } catch (error) {
    if (hasPreviousDist) renameSync(previousDist, 'dist');
    throw error;
  }
} finally {
  rmSync(stagedDist, { force: true, recursive: true });
  rmSync(toolchainRoot, { force: true, recursive: true });
}
