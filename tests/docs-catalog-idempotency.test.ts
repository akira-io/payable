import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const featureDocumentation = readFileSync('docs/features/14-idempotency.md', 'utf8');
const lifecycleDocumentation = readFileSync('docs/examples/45-catalog-lifecycle.md', 'utf8');
const expressDocumentation = readFileSync('docs/adapters/23-express.md', 'utf8');
const fastifyDocumentation = readFileSync('docs/adapters/24-fastify.md', 'utf8');
const nestDocumentation = readFileSync('docs/adapters/25-nestjs.md', 'utf8');
const mcpDocumentation = readFileSync('docs/adapters/26-mcp.md', 'utf8');
const stripeDocumentation = readFileSync('docs/integrations/18-stripe.md', 'utf8');
const paddleDocumentation = readFileSync('docs/integrations/19-paddle.md', 'utf8');

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

  it('does not describe the removed global configuration resolver', () => {
    expect(featureDocumentation).not.toContain('resolver?: IdempotencyKeyResolver');
    expect(featureDocumentation).not.toContain('idempotency.resolver');
  });
});
