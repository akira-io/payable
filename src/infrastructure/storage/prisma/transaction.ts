import type { PrismaClient, PrismaClientLike, PrismaTransactionLike } from './prisma-client.types';

export function runInTransaction<T>(
  client: PrismaClient,
  work: (tx: PrismaTransactionLike) => Promise<T>,
): Promise<T> {
  const candidate = client as PrismaClientLike;
  if (typeof candidate.$transaction === 'function') {
    return candidate.$transaction(work);
  }
  return work(client as PrismaTransactionLike);
}
