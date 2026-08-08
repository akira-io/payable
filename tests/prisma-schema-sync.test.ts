import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODELS_OUTPUT,
  readPayableModels,
  writePayableModels,
} from '../src/prisma/schema-sync';

const SUBSCRIPTION_SCHEMA_PATHS = [
  'prisma/models.prisma',
  'prisma/schema.prisma',
  'tests/prisma/schema.prisma',
] as const;

function subscriptionModelLines(path: string): string[] {
  const schema = readFileSync(path, 'utf8');
  const model = schema.match(/model PayableSubscription \{([\s\S]*?)\n\}/)?.[1];
  if (!model) {
    throw new Error(`PayableSubscription model is missing from ${path}`);
  }
  return model
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

function modelLines(path: string, modelName: string): string[] {
  const schema = readFileSync(path, 'utf8');
  const model = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (!model) {
    throw new Error(`${modelName} model is missing from ${path}`);
  }
  return model
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

describe('prisma schema sync', () => {
  it('reads bundled models without datasource or generator blocks', () => {
    const models = readPayableModels();
    expect(models).toContain('model PayableCustomer');
    expect(models).toContain('model PayableOutboxEvent');
    expect(models).toContain('occurredAt');
    expect(models).not.toMatch(/\bdatasource\s+\w+\s*\{/);
    expect(models).not.toMatch(/\bgenerator\s+\w+\s*\{/);
  });

  it('writes the models to a target path, creating parent directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'payable-sync-'));
    try {
      const target = writePayableModels(join(dir, 'schema/payable.prisma'));
      expect(readFileSync(target, 'utf8')).toContain('model PayablePayment');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults to the multi-file schema folder', () => {
    expect(DEFAULT_MODELS_OUTPUT).toBe('prisma/schema/payable.prisma');
  });

  it('keeps the complete subscription model aligned across all schema copies', () => {
    const [canonicalPath, ...copyPaths] = SUBSCRIPTION_SCHEMA_PATHS;
    const canonicalModel = subscriptionModelLines(canonicalPath);

    expect(copyPaths.map(subscriptionModelLines)).toEqual([canonicalModel, canonicalModel]);
  });

  it.each([
    'PayableCanonicalProduct',
    'PayableCanonicalPrice',
    'PayableProductProviderBinding',
    'PayablePriceProviderBinding',
    'PayableCatalogSynchronization',
    'PayableCustomerProviderSyncState',
    'PayableOutboxEvent',
  ])('keeps %s aligned across all schema copies', (modelName) => {
    const [canonicalPath, ...copyPaths] = SUBSCRIPTION_SCHEMA_PATHS;
    const canonicalModel = modelLines(canonicalPath, modelName);

    expect(copyPaths.map((path) => modelLines(path, modelName))).toEqual([
      canonicalModel,
      canonicalModel,
    ]);
  });
});
