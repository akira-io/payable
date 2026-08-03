import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PaymentProvider } from '../src/domain/contracts/payment-provider.contract';
import type { ProviderCapabilityValue } from '../src/domain/dtos/capabilities.dto';
import { PaddleProvider } from '../src/infrastructure/providers/paddle/paddle-provider';
import { RevolutProvider } from '../src/infrastructure/providers/revolut/revolut-provider';
import {
  SispProvider,
  type SispProviderOptions,
} from '../src/infrastructure/providers/sisp/sisp-provider';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';
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

const sispOptions: SispProviderOptions = {
  posId: '90000045',
  posAutCode: 'aut-code',
  database: { client: 'better-sqlite3', connection: { filename: ':memory:' } },
};

const builtInProviders = {
  Stripe: new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' }),
  Paddle: new PaddleProvider({ apiKey: 'pdl_test', webhookSecret: 'wh_test' }),
  SISP: new SispProvider(sispOptions),
  Revolut: new RevolutProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' }),
} satisfies Record<string, PaymentProvider>;

type ProviderName = keyof typeof builtInProviders;

interface DocumentedCapabilityRow {
  capability: ProviderCapabilityValue;
  support: Record<ProviderName, boolean>;
}

function tableCells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function documentedCapabilityRows(markdown: string): DocumentedCapabilityRow[] {
  const section = markdown.slice(
    markdown.indexOf('### Capability matrix'),
    markdown.indexOf('## The capabilities system'),
  );
  const lines = section.split('\n').filter((line) => line.startsWith('|'));
  const providerNames = tableCells(lines[0] ?? '').slice(1) as ProviderName[];

  return lines.slice(2).flatMap((line) => {
    const [label = '', ...cells] = tableCells(line);
    const match = label.match(/^`([a-z][A-Za-z]+)`/);
    if (!match?.[1]) {
      return [];
    }
    const support = Object.fromEntries(
      providerNames.map((provider, index) => {
        const value = cells[index] ?? '';
        expect(value).toMatch(/^(?:yes|no)(?: \(.+\))?$/);
        return [provider, value.startsWith('yes')];
      }),
    ) as Record<ProviderName, boolean>;
    return [{ capability: match[1], support }];
  });
}

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
    expect(reliability).toContain(
      '`MemoryLockDriver` is a working single-process direct-composition utility',
    );
    expect(reliability).toContain(
      '`MemoryCacheDriver` is a working single-process direct-composition utility',
    );
    expect(reliability).not.toContain('`MemoryLockDriver` (single-process) and `RedisLockDriver`');
    expect(reliability).not.toContain('Both are Phase 7 scaffolds that throw `NOT_IMPLEMENTED`');
  });

  it('matches the built-in provider capability matrix to runtime declarations', () => {
    const providers = readFileSync('docs/integrations/17-providers.md', 'utf8');

    for (const row of documentedCapabilityRows(providers)) {
      for (const [name, provider] of Object.entries(builtInProviders)) {
        expect(row.support[name as ProviderName], `${row.capability} on ${name}`).toBe(
          provider.capabilities().has(row.capability),
        );
      }
    }
  });
});
