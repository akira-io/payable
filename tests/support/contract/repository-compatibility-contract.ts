import { expect, it } from 'vitest';
import type { ContractContext } from './harness';

export function registerRepositoryCompatibilityContract(ctx: ContractContext): void {
  it('preserves null as an unscoped local identity for non-catalog repositories', async () => {
    const { storage } = ctx.harness();
    const created = await storage.customers.create({
      tenantId: 'tenant-a',
      billableType: 'User',
      billableId: 'legacy-null-scope',
      email: 'legacy-null@example.com',
      name: null,
      metadata: null,
    });

    await expect(storage.customers.findById(created.id, null)).resolves.toMatchObject({
      id: created.id,
      tenantId: 'tenant-a',
    });
    await expect(
      storage.customers.update(created.id, { name: 'Updated through null scope' }, null),
    ).resolves.toMatchObject({
      id: created.id,
      tenantId: 'tenant-a',
      name: 'Updated through null scope',
    });
  });
}
