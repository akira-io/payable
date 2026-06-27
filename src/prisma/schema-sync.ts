import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MODELS_OUTPUT = 'prisma/schema/payable.prisma';

const MAX_ROOT_LOOKUP_DEPTH = 8;

function modelsPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < MAX_ROOT_LOOKUP_DEPTH; depth += 1) {
    const candidate = join(dir, 'prisma', 'models.prisma');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error('payable: prisma/models.prisma not found in the installed package');
}

export function readPayableModels(): string {
  return readFileSync(modelsPath(), 'utf8');
}

export function writePayableModels(outPath: string = DEFAULT_MODELS_OUTPUT): string {
  const target = resolve(process.cwd(), outPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readPayableModels());
  return target;
}
