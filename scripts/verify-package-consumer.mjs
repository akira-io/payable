import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PACKAGE_NAME = '@akira-io/payable';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: options.captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let output = '';

    if (options.captureOutput) {
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
    }

    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} was terminated by ${signal}`));
        return;
      }
      resolve({ code, output });
    });
  });
}

async function runOrThrow(command, args, options) {
  const { code, output } = await run(command, args, options);
  if (code !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${code}\n${output}`);
  }
}

async function writeConsumerFiles(directory) {
  await Promise.all([
    writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ name: 'payable-package-consumer', private: true, type: 'module' }, null, 2),
    ),
    writeFile(
      join(directory, 'consumer.ts'),
      `import * as core from '${PACKAGE_NAME}';
import type {
  Payment,
  PaymentProvider,
  PriceDTO,
  Subscription,
  SubscriptionPriceMigrationResource,
} from '${PACKAGE_NAME}';
import * as express from '${PACKAGE_NAME}/express';
import * as fastify from '${PACKAGE_NAME}/fastify';
import * as nest from '${PACKAGE_NAME}/nest';
import * as mcp from '${PACKAGE_NAME}/mcp';
import * as prisma from '${PACKAGE_NAME}/prisma';
import * as sisp from '${PACKAGE_NAME}/sisp';

declare const migrations: SubscriptionPriceMigrationResource;
declare const payment: Payment;
declare const provider: PaymentProvider;
declare const price: PriceDTO;
declare const subscription: Subscription;
void migrations.preview;
void [core, express, fastify, mcp, nest, payment, prisma, provider, price, sisp, subscription];
`,
    ),
    writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true,
            skipLibCheck: true,
            strict: true,
          },
          include: ['consumer.ts'],
        },
        null,
        2,
      ),
    ),
  ]);
}

async function installedSpecifiers(directory) {
  const packageJsonPath = join(directory, 'node_modules', PACKAGE_NAME, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

  return Object.keys(packageJson.exports ?? {}).map((subpath) =>
    subpath === '.' ? PACKAGE_NAME : `${PACKAGE_NAME}/${subpath.slice(2)}`,
  );
}

async function installPeerDependencies(directory, packageSpec) {
  const packageJsonPath = join(directory, 'node_modules', PACKAGE_NAME, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const peers = Object.entries(packageJson.peerDependencies ?? {}).map(
    ([name, range]) => `${name}@${range}`,
  );
  if (peers.length > 0) {
    await runOrThrow('bun', ['add', '--dev', packageSpec, ...peers], {
      cwd: directory,
      captureOutput: true,
    });
  }
}

async function verifyBinaries(directory) {
  for (const binary of ['payable-prisma', 'payable-mcp']) {
    const path = join(directory, 'node_modules', '.bin', binary);
    await runOrThrow(process.execPath, [path, '--help'], {
      cwd: directory,
      captureOutput: true,
    });
  }
}

async function verifyPrismaAsset(directory) {
  const packageDirectory = join(directory, 'node_modules', PACKAGE_NAME);
  const expectedModelsPath = join(packageDirectory, 'prisma', 'models.prisma');
  const outputPath = join(directory, 'prisma', 'payable.models.prisma');
  const binaryPath = join(directory, 'node_modules', '.bin', 'payable-prisma');

  await runOrThrow(process.execPath, [binaryPath, 'sync', outputPath], {
    cwd: directory,
    captureOutput: true,
  });

  const [expectedModels, generatedModels] = await Promise.all([
    readFile(expectedModelsPath, 'utf8'),
    readFile(outputPath, 'utf8'),
  ]);
  if (generatedModels !== expectedModels) {
    throw new Error('payable-prisma sync did not copy the installed Prisma models');
  }

  console.log('Prisma asset verified');
}

async function main() {
  const packageSpec = process.argv[2];
  if (!packageSpec) {
    throw new Error('Usage: bun run verify:consumer -- <package-spec>');
  }

  const directory = await mkdtemp(join(tmpdir(), 'payable-package-consumer-'));
  try {
    await writeConsumerFiles(directory);
    await runOrThrow('bun', ['add', '--exact', packageSpec], {
      cwd: directory,
      captureOutput: true,
    });
    await installPeerDependencies(directory, packageSpec);
    await runOrThrow('bunx', ['tsc', '--noEmit', '--project', 'tsconfig.json'], {
      cwd: directory,
      captureOutput: true,
    });

    const specifiers = await installedSpecifiers(directory);
    await writeFile(
      join(directory, 'esm.mjs'),
      `for (const specifier of ${JSON.stringify(specifiers)}) await import(specifier);\n`,
    );
    await writeFile(
      join(directory, 'cjs.cjs'),
      `for (const specifier of ${JSON.stringify(specifiers)}) require(specifier);\n`,
    );
    await runOrThrow(process.execPath, ['esm.mjs'], { cwd: directory, captureOutput: true });
    await runOrThrow(process.execPath, ['cjs.cjs'], { cwd: directory, captureOutput: true });
    await verifyBinaries(directory);
    await verifyPrismaAsset(directory);

    console.log(`Package consumer verified from ${packageSpec}`);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
