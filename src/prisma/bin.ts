#!/usr/bin/env node
import { DEFAULT_MODELS_OUTPUT, readPayableModels, writePayableModels } from './schema-sync';

const USAGE = `Usage: payable-prisma <command> [outPath]

  sync [outPath]  Copy Payable models into your project (default ${DEFAULT_MODELS_OUTPUT})
  print           Print the Payable models to stdout
`;

function run(): void {
  const command = process.argv[2];
  switch (command) {
    case 'print':
      process.stdout.write(readPayableModels());
      return;
    case 'sync': {
      const target = writePayableModels(process.argv[3]);
      process.stdout.write(`payable-prisma: wrote models to ${target}\n`);
      return;
    }
    default:
      process.stdout.write(USAGE);
      process.exitCode = command === undefined ? 0 : 1;
  }
}

run();
