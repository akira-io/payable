import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type {
  CreatePriceInput,
  PriceDTO,
  TransferPriceLookupKeyInput,
} from '../src/domain/dtos/price.dto';
import { Money } from '../src/domain/value-objects/money';
import { FakeProvider } from './support/fake-provider';

class LookupKeyProvider extends FakeProvider {
  createCalls = 0;
  listCalls = 0;
  transferCalls = 0;
  lastCreateContext?: OperationContext;
  lastTransferContext?: OperationContext;
  lastLookupList?: { lookupKeys?: string[] };

  constructor() {
    super();
    this.supportedCapabilities.add('priceLookupKeys');
  }

  override async createPrice(
    input: CreatePriceInput,
    context?: OperationContext,
  ): Promise<PriceDTO> {
    this.createCalls += 1;
    this.lastCreateContext = context;
    return {
      providerPriceId: `price_${this.createCalls}`,
      providerProductId: input.providerProductId,
      unitAmount: input.unitAmount,
      interval: input.interval ?? null,
      intervalCount: input.intervalCount ?? null,
      description: input.description ?? null,
      active: true,
      lookupKey: input.lookupKey ?? null,
    };
  }

  override async listPrices(input?: {
    lookupKeys?: string[];
  }): Promise<{ data: PriceDTO[]; nextCursor: null }> {
    this.listCalls += 1;
    this.lastLookupList = input;
    return {
      data: [
        {
          providerPriceId: 'price_list',
          providerProductId: 'prod_1',
          unitAmount: Money.of(1000, 'USD'),
          interval: null,
          intervalCount: null,
          description: null,
          active: true,
          lookupKey: input?.lookupKeys?.[0] ?? null,
        },
      ],
      nextCursor: null,
    };
  }

  async transferPriceLookupKey(
    input: TransferPriceLookupKeyInput,
    context: OperationContext,
  ): Promise<PriceDTO> {
    this.transferCalls += 1;
    this.lastTransferContext = context;
    return {
      providerPriceId: input.providerPriceId,
      providerProductId: 'prod_1',
      unitAmount: Money.of(1000, 'USD'),
      interval: null,
      intervalCount: null,
      description: null,
      active: true,
      lookupKey: input.lookupKey,
    };
  }
}

function prices(provider: FakeProvider) {
  return createPayable({ providers: { stripe: provider } }).prices();
}

function createInput(overrides: Partial<CreatePriceInput> = {}): CreatePriceInput {
  return { providerProductId: 'prod_1', unitAmount: Money.of(1000, 'USD'), ...overrides };
}

async function expectInvalid(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code: 'PRICE_LOOKUP_KEY_INVALID',
    context: expect.objectContaining({ field: expect.any(String) }),
  });
}

describe('price lookup key resource behavior', () => {
  it('keeps ordinary create and list available to generic catalog providers', async () => {
    const provider = new FakeProvider();
    const resource = prices(provider);

    const created = await resource.create(createInput());
    const listed = await resource.list();

    expect(created.lookupKey).toBeNull();
    expect(listed.data).toHaveLength(1);
    expect(provider.lastCreatePrice).toMatchObject({ providerProductId: 'prod_1' });
    expect(provider.lastListPrices).toMatchObject({ limit: 50, active: true });
  });

  it('rejects every lookup operation before calling a provider without the lookup capability', async () => {
    const provider = new FakeProvider();
    const resource = prices(provider);

    await expect(resource.create(createInput({ lookupKey: 'monthly' }))).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
      context: { capability: 'priceLookupKeys' },
    });
    await expect(
      resource.create(createInput({ lookupKey: 'monthly', transferLookupKey: true })),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
      context: { capability: 'priceLookupKeys' },
    });
    await expect(resource.list({ lookupKeys: [] })).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
    });
    await expect(
      resource.transferLookupKey({ providerPriceId: 'price_1', lookupKey: 'monthly' }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
    });
    expect(provider.lastCreatePrice).toBeUndefined();
    expect(provider.lastListPrices).toBeUndefined();
  });

  it('requires the complete lookup-provider operation set after the capability is declared', async () => {
    const provider = new FakeProvider();
    provider.supportedCapabilities.add('priceLookupKeys');

    await expect(
      prices(provider).create(createInput({ lookupKey: 'monthly' })),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
      context: { capability: 'priceLookupKeys' },
    });
    expect(provider.lastCreatePrice).toBeUndefined();
  });

  it('validates lookup-aware create input locally and preserves accepted lookup strings', async () => {
    const provider = new LookupKeyProvider();
    const resource = prices(provider);
    const valid = ` ${'😀'.repeat(199)}`;

    await expectInvalid(
      resource.create(createInput({ lookupKey: '   ', transferLookupKey: true })),
    );
    await expectInvalid(resource.create(createInput({ lookupKey: '\uD800' })));
    await expectInvalid(resource.create(createInput({ lookupKey: 12 as never })));
    await expectInvalid(resource.create(createInput({ lookupKey: '😀'.repeat(201) })));
    await expectInvalid(resource.create(createInput({ transferLookupKey: true })));
    await expectInvalid(resource.create(createInput({ transferLookupKey: 'yes' as never })));
    await resource.create(createInput({ lookupKey: 'x' }));
    await resource.create(createInput({ lookupKey: valid, transferLookupKey: false }));
    await resource.create(createInput({ transferLookupKey: false }));

    expect(provider.createCalls).toBe(3);
    expect(provider.lastCreatePrice?.lookupKey).toBeUndefined();
  });

  it('validates lookup lists before provider calls and returns an empty local page for an empty list', async () => {
    const provider = new LookupKeyProvider();
    const resource = prices(provider);

    await expectInvalid(resource.list({ lookupKeys: [''] }));
    await expectInvalid(resource.list({ lookupKeys: ['monthly', '\uDC00'] }));
    await expectInvalid(resource.list({ lookupKeys: Array.from({ length: 11 }, () => 'monthly') }));
    await expectInvalid(resource.list({ lookupKeys: 'monthly' as never }));
    expect(await resource.list({ lookupKeys: [] })).toEqual({ data: [], nextCursor: null });
    await resource.list({ lookupKeys: [' monthly '] });

    expect(provider.listCalls).toBe(1);
    expect(provider.lastLookupList).toEqual({ lookupKeys: [' monthly '], limit: 50, active: true });
  });

  it('rejects sparse lookup lists before provider calls', async () => {
    const provider = new LookupKeyProvider();
    const sparseLookupKeys = new Array<string>(1);

    await expectInvalid(prices(provider).list({ lookupKeys: sparseLookupKeys }));

    expect(provider.listCalls).toBe(0);
  });

  it('validates an empty lookup-list page before returning it locally', async () => {
    const provider = new LookupKeyProvider();

    await expect(prices(provider).list({ lookupKeys: [], limit: 0 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    expect(provider.listCalls).toBe(0);
  });

  it('validates and transfers a lookup key through the capability-gated provider boundary', async () => {
    const provider = new LookupKeyProvider();
    const resource = prices(provider);

    await expectInvalid(resource.transferLookupKey({ providerPriceId: '', lookupKey: 'monthly' }));
    await expectInvalid(resource.transferLookupKey({ providerPriceId: 'price_1', lookupKey: ' ' }));
    const transferred = await resource.transferLookupKey({
      providerPriceId: 'price_1',
      lookupKey: ' monthly ',
    });

    expect(transferred).toMatchObject({ providerPriceId: 'price_1', lookupKey: ' monthly ' });
    expect(provider.transferCalls).toBe(1);
  });
});
