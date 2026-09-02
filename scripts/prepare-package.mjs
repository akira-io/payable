import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function runCommand(command, commandArguments) {
  const execution = spawnSync(command, commandArguments, { stdio: 'inherit' });
  if (execution.error) throw execution.error;
  if (execution.status !== 0) process.exit(execution.status ?? 1);
}

if (!existsSync(join('node_modules', '.bin', 'tsup'))) {
  runCommand('bun', ['install', '--frozen-lockfile', '--ignore-scripts']);
}

runCommand('npm', ['run', 'build']);
