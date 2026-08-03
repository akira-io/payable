import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

const documentedConfigKeys = [
  'tenant',
  'authorization',
  'providers',
  'accountingProviders',
  'identityProviders',
  'issuingProviders',
  'marketplaceProviders',
  'taxProviders',
  'terminalProviders',
  'treasuryProviders',
  'storage',
  'queue',
  'clock',
  'logger',
  'events',
  'encryption',
  'idempotency',
] as const satisfies readonly (keyof PayableConfig)[];

type MissingDocumentedConfigKey = Exclude<
  keyof PayableConfig,
  (typeof documentedConfigKeys)[number]
>;

const documentsEveryConfigKey: MissingDocumentedConfigKey extends never ? true : false = true;

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

function documentedPayableConfigKeys(markdown: string): string[] {
  return Array.from(markdown.matchAll(/^### `([a-zA-Z]+)(?:\?|:)/gm), (match) => match[1] ?? '');
}

function publicMarkdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'superpowers' ? [] : publicMarkdownFiles(path);
    }
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });
}

function createPayableCodeFences(markdown: string): string[] {
  return Array.from(
    markdown.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g),
    (match) => match[1] ?? '',
  ).filter((code) => code.includes('createPayable({'));
}

function documentedCapabilityRows(markdown: string): DocumentedCapabilityRow[] {
  const startIndex = markdown.search(/^### Capability matrix$/m);
  const endIndex = markdown.search(/^## The capabilities system$/m);
  if (startIndex < 0 || endIndex < 0 || startIndex >= endIndex) {
    throw new Error('Capability matrix section markers are missing or out of order');
  }

  const section = markdown.slice(startIndex, endIndex);
  const lines = section.split('\n').filter((line) => line.startsWith('|'));
  const headers = tableCells(lines[0] ?? '');
  const expectedHeaders = ['Capability', ...Object.keys(builtInProviders)];
  if (headers.join('|') !== expectedHeaders.join('|')) {
    throw new Error('Capability matrix provider headers do not match built-in providers');
  }

  const providerNames = headers.slice(1) as ProviderName[];
  const rows = lines.slice(2).flatMap((line) => {
    const [label = '', ...cells] = tableCells(line);
    const match = label.match(/^`([a-z][A-Za-z]+)`/);
    if (!match?.[1]) {
      return [];
    }

    const support = Object.fromEntries(
      providerNames.map((provider, index) => {
        const value = cells[index] ?? '';
        if (!/^(?:yes|no)(?: \(.+\))?$/.test(value)) {
          throw new Error(`Invalid capability support value: ${value}`);
        }
        return [provider, value.startsWith('yes')];
      }),
    ) as Record<ProviderName, boolean>;
    return [{ capability: match[1], support }];
  });

  if (rows.length === 0) {
    throw new Error('Capability matrix must include a lowercase capability row');
  }

  const documentedCapabilities = rows.map((row) => row.capability);
  if (new Set(documentedCapabilities).size !== documentedCapabilities.length) {
    throw new Error('Capability matrix must not contain duplicate capability rows');
  }

  const runtimeCapabilities = new Set(
    Object.values(builtInProviders).flatMap((provider) => [...provider.capabilities()]),
  );
  if (
    documentedCapabilities.toSorted().join('|') !== [...runtimeCapabilities].toSorted().join('|')
  ) {
    throw new Error('Capability matrix rows do not match built-in provider capabilities');
  }

  return rows;
}

describe('documentation stays aligned with runtime', () => {
  it('documents only configuration accepted by createPayable', () => {
    const configuration = readFileSync('docs/04-configuration.md', 'utf8');
    const contracts = readFileSync('docs/domain/33-contracts.md', 'utf8');
    const gettingStarted = readFileSync('docs/03-getting-started.md', 'utf8');
    const reliability = readFileSync('docs/features/15-reliability.md', 'utf8');

    expect(documentedConfig.providers.fake).toBeInstanceOf(FakeProvider);
    expect(documentsEveryConfigKey).toBe(true);
    expect(documentedPayableConfigKeys(configuration)).toEqual(documentedConfigKeys);
    expect(configuration).not.toMatch(/^### `(?:cache|locks)\??:/m);
    expect(configuration).not.toMatch(/^\| `(?:cache|locks)` \|/m);
    expect(configuration).toContain('CONFIG_OPTION_UNSUPPORTED');
    expect(configuration).toContain('direct composition');
    expect(gettingStarted).not.toContain('Storage, cache, locks, and encryption stay');
    expect(reliability).not.toContain('`locks` on `PayableConfig`');
    expect(reliability).not.toContain('`cache` on `PayableConfig`');
    expect(reliability).not.toContain('integrating application can supply its own driver');
    expect(reliability).toContain('not accepted by `createPayable`');
    expect(reliability).toContain(
      '`MemoryLockDriver` is a working single-process direct-composition utility',
    );
    expect(reliability).toContain(
      '`MemoryCacheDriver` is a working single-process direct-composition utility',
    );
    expect(reliability).not.toContain('`MemoryLockDriver` (single-process) and `RedisLockDriver`');
    expect(reliability).not.toContain('Both are Phase 7 scaffolds that throw `NOT_IMPLEMENTED`');
    expect(reliability).toMatch(
      /`RedisLockDriver`[\s\S]+?constructor throws `NOT_IMPLEMENTED` before\s+`acquire` or `withLock` can run\./,
    );
    expect(reliability).toMatch(
      /`RedisCacheDriver`[\s\S]+?constructor throws `NOT_IMPLEMENTED` before `get`, `set`,\s+`delete`, or `has` can run\./,
    );
    expect(contracts).toMatch(
      /`MemoryCacheDriver` and `MemoryLockDriver` can be instantiated and used directly outside\s+`createPayable`/,
    );
    expect(contracts).toMatch(
      /Each Redis constructor throws `NOT_IMPLEMENTED` before cache operations, `acquire`, or\s+`withLock` can run\./,
    );
  });

  it('keeps unsupported drivers out of public createPayable examples', () => {
    for (const path of publicMarkdownFiles('docs')) {
      const markdown = readFileSync(path, 'utf8');
      for (const code of createPayableCodeFences(markdown)) {
        expect(code, path).not.toMatch(/^\s*(?:cache|locks)\s*:/m);
      }
    }
  });

  it('fails closed when the capability matrix structure is invalid', () => {
    const providers = readFileSync('docs/integrations/17-providers.md', 'utf8');
    const renamedSection = providers.replace(
      '### Capability matrix',
      '### Provider capability matrix',
    );
    const missingSection = providers.replace('## The capabilities system', '## Capability sets');
    const suffixedStartSection = providers.replace(
      '### Capability matrix',
      '### Capability matrix v2',
    );
    const suffixedEndSection = providers.replace(
      '## The capabilities system',
      '## The capabilities system v2',
    );
    const invertedSections = providers
      .replace('### Capability matrix', '### Built-in provider matrix')
      .replace('## The capabilities system', '## The capabilities system\n\n### Capability matrix');
    const invalidHeader = providers.replace(
      '| Capability | Stripe | Paddle | SISP | Revolut |',
      '| Capability | Stripe | Paddle | SISP | Adyen |',
    );
    const withoutRows = providers.replace(/^\| `[a-z][^\n]+\n/gm, '');
    const withoutCheckout = providers.replace(/^\| `checkout`[^\n]+\n/m, '');
    const duplicateCheckout = providers.replace(/(^\| `checkout`[^\n]+\n)/m, '$1$1');
    const unknownCapability = providers.replace(
      /(^\| `checkout`[^\n]+\n)/m,
      '$1| `unknownCapability` | no | no | no | no |\n',
    );

    expect(() => documentedCapabilityRows(renamedSection)).toThrow(
      'Capability matrix section markers are missing or out of order',
    );
    expect(() => documentedCapabilityRows(missingSection)).toThrow(
      'Capability matrix section markers are missing or out of order',
    );
    expect(() => documentedCapabilityRows(suffixedStartSection)).toThrow(
      'Capability matrix section markers are missing or out of order',
    );
    expect(() => documentedCapabilityRows(suffixedEndSection)).toThrow(
      'Capability matrix section markers are missing or out of order',
    );
    expect(() => documentedCapabilityRows(invertedSections)).toThrow(
      'Capability matrix section markers are missing or out of order',
    );
    expect(() => documentedCapabilityRows(invalidHeader)).toThrow(
      'Capability matrix provider headers do not match built-in providers',
    );
    expect(() => documentedCapabilityRows(withoutRows)).toThrow(
      'Capability matrix must include a lowercase capability row',
    );
    expect(() => documentedCapabilityRows(withoutCheckout)).toThrow(
      'Capability matrix rows do not match built-in provider capabilities',
    );
    expect(() => documentedCapabilityRows(duplicateCheckout)).toThrow(
      'Capability matrix must not contain duplicate capability rows',
    );
    expect(() => documentedCapabilityRows(unknownCapability)).toThrow(
      'Capability matrix rows do not match built-in provider capabilities',
    );
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
