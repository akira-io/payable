import { createPrismaHarness } from './support/prisma';
import { describeStorageContract } from './support/storage-contract';

describeStorageContract('Prisma', createPrismaHarness);
