import { expect, it } from 'vitest';
import { createPayable } from '../../../src/create-payable';
import { CatalogPersistenceError } from '../../../src/domain/errors/catalog-persistence.error';
import { withProductCasLoss } from '../catalog-cas-recovery-storage';
import {
  withLostTransactionAcknowledgement,
  withMatchingProductCreateWinner,
} from '../catalog-recovery-storage';
import { FakeProvider } from '../fake-provider';
import type { ContractContext } from './harness';

export function registerCatalogMutationRecoveryContract(context: ContractContext): void {
  it('recovers a committed catalog transition after its acknowledgement is lost', async () => {
    const { storage, clock } = context.harness();
    const lostAcknowledgement = new Error('commit acknowledgement lost');
    const products = createPayable({
      providers: { registered: new FakeProvider() },
      storage: withLostTransactionAcknowledgement(storage, lostAcknowledgement),
      clock,
    }).providerCatalog('registered', 'tenant-a').products;

    await expect(products.create({ name: 'Pro' })).resolves.toMatchObject({
      providerProductId: 'prod_fake',
    });

    await expect(
      storage.products.findByProviderId('registered', 'prod_fake', 'tenant-a'),
    ).resolves.toMatchObject({ name: 'Pro' });
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toHaveLength(1);
    expect(await storage.outboxEvents.claimPending(10)).toHaveLength(1);
  });

  it('classifies a matching create winner after one recovery read', async () => {
    const { storage, clock } = context.harness();
    const recoveryReads = { count: 0 };
    const concurrentStorage = withMatchingProductCreateWinner(
      storage,
      {
        tenantId: 'tenant-a',
        provider: 'registered',
        providerProductId: 'prod_fake',
        name: 'Pro',
        description: null,
        active: true,
        metadata: null,
      },
      recoveryReads,
    );
    const products = createPayable({
      providers: { registered: new FakeProvider() },
      storage: concurrentStorage,
      clock,
    }).providerCatalog('registered', 'tenant-a').products;

    await expect(products.create({ name: 'Pro' })).resolves.toMatchObject({
      providerProductId: 'prod_fake',
    });

    expect(recoveryReads.count).toBe(1);
    await expect(
      storage.products.findByProviderId('registered', 'prod_fake', 'tenant-a'),
    ).resolves.toMatchObject({ name: 'Pro' });
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toEqual([]);
    expect(await storage.outboxEvents.claimPending(10)).toEqual([]);
  });

  it('classifies a matching compare-and-set winner after one recovery read', async () => {
    const { storage, clock } = context.harness();
    const durable = await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerProductId: 'prod_fake',
      name: 'Converged target',
      description: null,
      active: true,
      metadata: null,
    });
    const reads = { recovery: 0, transaction: 0 };
    const products = createPayable({
      providers: { registered: new FakeProvider() },
      storage: withProductCasLoss(storage, reads, { ...durable, name: 'Stale state' }),
      clock,
    }).providerCatalog('registered', 'tenant-a').products;

    await expect(
      products.update({ providerProductId: 'prod_fake', name: 'Converged target' }),
    ).resolves.toMatchObject({ providerProductId: 'prod_fake' });

    expect(reads).toEqual({ recovery: 1, transaction: 1 });
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toEqual([]);
    expect(await storage.outboxEvents.claimPending(10)).toEqual([]);
  });

  it('rejects a mismatching compare-and-set winner without stale events', async () => {
    const { storage, clock } = context.harness();
    await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerProductId: 'prod_fake',
      name: 'Durable winner',
      description: null,
      active: true,
      metadata: null,
    });
    const reads = { recovery: 0, transaction: 0 };
    const products = createPayable({
      providers: { registered: new FakeProvider() },
      storage: withProductCasLoss(storage, reads),
      clock,
    }).providerCatalog('registered', 'tenant-a').products;

    const failure = products
      .update({ providerProductId: 'prod_fake', name: 'Divergent target' })
      .catch((error: unknown) => error);

    await expect(failure).resolves.toBeInstanceOf(CatalogPersistenceError);
    await expect(failure).resolves.toMatchObject({
      code: 'CATALOG_PERSISTENCE_FAILED',
      context: { providerResourceId: 'prod_fake', action: 'product.update' },
    });
    expect(reads).toEqual({ recovery: 1, transaction: 1 });
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toEqual([]);
    expect(await storage.outboxEvents.claimPending(10)).toEqual([]);
  });
}
