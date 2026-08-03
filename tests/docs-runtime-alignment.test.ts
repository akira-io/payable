import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PayableConfig } from '../src/support/config/payable-config';
import { FakeProvider } from './support/fake-provider';

const documentedConfig = {
  tenant: { enabled: false },
  authorization: { enabled: false },
  providers: { fake: new FakeProvider() },
  accountingProviders: {},
  identityProviders: {},
  issuingProviders: {},
  marketplaceProviders: {},
  taxProviders: {},
  terminalProviders: {},
  treasuryProviders: {},
  idempotency: { enabled: true, strategy: 'auto' },
} satisfies PayableConfig;

describe('documentation stays aligned with runtime', () => {
  it('documents only configuration accepted by createPayable', () => {
    const configuration = readFileSync('docs/04-configuration.md', 'utf8');
    const gettingStarted = readFileSync('docs/03-getting-started.md', 'utf8');
    const reliability = readFileSync('docs/features/15-reliability.md', 'utf8');

    expect(documentedConfig.providers.fake).toBeInstanceOf(FakeProvider);
    expect(configuration).not.toMatch(/^### `(?:cache|locks)\??:/m);
    expect(configuration).not.toMatch(/^\| `(?:cache|locks)` \|/m);
    expect(configuration).toContain('CONFIG_OPTION_UNSUPPORTED');
    expect(configuration).toContain('direct composition');
    expect(gettingStarted).not.toContain('Storage, cache, locks, and encryption stay');
    expect(reliability).not.toContain('`locks` on `PayableConfig`');
    expect(reliability).not.toContain('`cache` on `PayableConfig`');
    expect(reliability).toContain('not accepted by `createPayable`');
  });
});
