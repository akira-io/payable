import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const featureDocumentation = readFileSync('docs/features/14-idempotency.md', 'utf8');
const configurationDocumentation = readFileSync('docs/04-configuration.md', 'utf8');
const lifecycleDocumentation = readFileSync('docs/examples/45-catalog-lifecycle.md', 'utf8');
const expressDocumentation = readFileSync('docs/adapters/23-express.md', 'utf8');
const fastifyDocumentation = readFileSync('docs/adapters/24-fastify.md', 'utf8');
const nestDocumentation = readFileSync('docs/adapters/25-nestjs.md', 'utf8');
const mcpDocumentation = readFileSync('docs/adapters/26-mcp.md', 'utf8');
const stripeDocumentation = readFileSync('docs/integrations/18-stripe.md', 'utf8');
const paddleDocumentation = readFileSync('docs/integrations/19-paddle.md', 'utf8');

function documentationSection(documentation: string, heading: string, nextHeading: string): string {
  const start = documentation.indexOf(heading);
  const end = documentation.indexOf(nextHeading, start + heading.length);
  if (start < 0 || end < 0) {
    throw new Error(`Missing documentation section: ${heading}`);
  }
  return documentation.slice(start, end).replace(/\s+/g, ' ');
}

describe('catalog idempotency documentation', () => {
  it('documents the core catalog mutation contract and effective identity', () => {
    expect(featureDocumentation).toContain('CatalogMutationOptions');
    expect(featureDocumentation).toContain('idempotencyKey?: string');
    expect(featureDocumentation).toContain(
      "payable.products('stripe-primary', 'tenant-acme').create",
    );
    expect(featureDocumentation).toContain("{ idempotencyKey: 'catalog-product-pro-v1' }");
    expect(featureDocumentation).toContain('tenant scope');
    expect(featureDocumentation).toContain('registered provider');
    expect(featureDocumentation).toContain('catalog operation');
    expect(featureDocumentation).toContain('caller key');
    expect(featureDocumentation).toContain('payable:catalog:v1:');
    expect(featureDocumentation).toContain('raw caller key is never forwarded');
  });

  it('documents every catalog configuration and recovery outcome', () => {
    expect(featureDocumentation).toContain('`auto`');
    expect(featureDocumentation).toContain('`manual`');
    expect(featureDocumentation).toContain('`enabled: false`');
    expect(featureDocumentation).toContain('CATALOG_IDEMPOTENCY_STORAGE_REQUIRED');
    expect(featureDocumentation).toContain('IDEMPOTENCY_RECONCILIATION_REQUIRED');
    expect(featureDocumentation).toContain('not a distributed transaction');
    expect(lifecycleDocumentation).toMatch(/list or retrieve the catalog entity/i);
    expect(lifecycleDocumentation).toMatch(/new key represents a new intentional\s+operation/i);
  });

  it('documents fenced completion and authoritative replay in the execution section', () => {
    const execution = documentationSection(
      featureDocumentation,
      '## Execution flow',
      '## Catalog mutation idempotency',
    );

    for (const contractTerm of [
      'scoped key',
      'lockToken',
      'completedTtlMs',
      'markCompleted',
      'silent zero-row',
      'revive',
      'authoritative stored response',
      'reconciliation-required',
    ]) {
      expect(execution).toContain(contractTerm);
    }
    expect(execution).toMatch(/reads? the scoped record after `markCompleted`/i);
    expect(execution).toMatch(/different lock token/i);
    expect(execution).toMatch(/failed and expired records are eligible for `takeOver`/i);
    expect(execution).toMatch(/only when `takeOver` does not claim the record/i);
    expect(execution).not.toContain(
      'await this.store.markCompleted(execution.key, result, execution.tenantId)',
    );
    expect(execution).not.toContain(
      'const existing = await this.store.find(execution.key, execution.tenantId)',
    );
  });

  it('documents the HTTP and MCP inputs', () => {
    for (const adapterDocumentation of [
      expressDocumentation,
      fastifyDocumentation,
      nestDocumentation,
    ]) {
      expect(adapterDocumentation).toContain('Idempotency-Key');
      expect(adapterDocumentation).toContain('catalog-product-pro-v1');
    }
    expect(expressDocumentation).toContain("-H 'Idempotency-Key: catalog-product-pro-v1'");
    expect(mcpDocumentation).toContain('"idempotencyKey": "catalog-product-pro-v1"');
  });

  it('documents provider behavior from the official sources', () => {
    expect(stripeDocumentation).toContain('https://docs.stripe.com/api/idempotent_requests');
    expect(stripeDocumentation).toContain('catalogIdempotency');
    expect(paddleDocumentation).toContain('https://developer.paddle.com/sdks/libraries/');
    expect(paddleDocumentation).toContain('CATALOG_IDEMPOTENCY_STORAGE_REQUIRED');
    expect(paddleDocumentation).toContain('IDEMPOTENCY_RECONCILIATION_REQUIRED');
  });

  it('locates direct resolver injection on the action instead of the service', () => {
    const featureConfiguration = documentationSection(
      featureDocumentation,
      '## Configuration',
      '## Non-catalog key resolution',
    );
    const configurationReference = documentationSection(
      configurationDocumentation,
      '## `IdempotencyConfig`',
      '## `TenantConfig`',
    );

    for (const idempotencyConfiguration of [featureConfiguration, configurationReference]) {
      expect(idempotencyConfiguration).not.toMatch(
        /IdempotencyKeyResolver[^.]*injected into `?IdempotencyService`? directly/i,
      );
      expect(idempotencyConfiguration).not.toContain('resolver?: IdempotencyKeyResolver');
      expect(idempotencyConfiguration).not.toContain('idempotency.resolver');
    }
    expect(configurationReference).toContain('ExecuteIdempotentOperationAction');
  });

  it('documents result-persistence reconciliation without authorizing a new operation', () => {
    const recovery = documentationSection(
      lifecycleDocumentation,
      '### Recover a confirmed provider mutation',
      '## Provider references',
    );

    expect(recovery).toContain('IDEMPOTENCY_RESULT_PERSISTENCE_FAILED');
    expect(recovery).toMatch(/callback may have succeeded/i);
    expect(recovery).toContain('correlationId');
    expect(recovery).toMatch(/provider and durable local state/i);
    expect(recovery).toMatch(/do not use a new key before reconciliation/i);
    expect(recovery).not.toMatch(
      /\b(?:can|may|should)\s+(?:use|issue|create)\s+(?:a\s+)?new key before reconciliation\b/i,
    );
    expect(recovery).toContain('native provider');
    expect(recovery).toContain('non-native provider');
  });
});
