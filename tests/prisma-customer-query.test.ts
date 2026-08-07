import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/infrastructure/storage/prisma/prisma-client.types';
import { PrismaCustomerRepository } from '../src/infrastructure/storage/prisma/repositories/prisma-customers.repository';
import { FakeClock } from '../src/support/clock/fake-clock';

describe('Prisma logical customer queries', () => {
  it('requests case-insensitive text matching from PostgreSQL', async () => {
    let customerQuery: Record<string, unknown> | undefined;
    const client = {
      _activeProvider: 'postgresql',
      payableCustomer: {
        findMany: async (query: Record<string, unknown>) => {
          customerQuery = query;
          return [];
        },
      },
    } as unknown as PrismaClient;
    const repository = new PrismaCustomerRepository(client, new FakeClock());

    await repository.list({ limit: 25, email: 'ADA', name: 'LOVE' }, 'tenant-a');

    expect(customerQuery).toMatchObject({
      where: {
        AND: [
          { tenantId: 'tenant-a' },
          {},
          {},
          {},
          { email: { contains: 'ADA', mode: 'insensitive' } },
          { name: { contains: 'LOVE', mode: 'insensitive' } },
        ],
      },
    });
  });
});
