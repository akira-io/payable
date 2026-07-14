import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODELS_OUTPUT,
  readPayableModels,
  writePayableModels,
} from '../src/prisma/schema-sync';

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
});
