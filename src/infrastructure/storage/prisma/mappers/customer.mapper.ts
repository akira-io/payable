import type { NewCustomer } from '../../../../domain/contracts/customer-repository.contract';
import type { Metadata } from '../../../../domain/entities/common';
import type { Customer } from '../../../../domain/entities/customer.entity';
import type { PrismaCustomerRow } from '../prisma-client.types';
import { parseJson, toJsonString } from './shared';

export function customerToEntity(row: PrismaCustomerRow): Customer {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    provider: row.provider,
    providerCustomerId: row.providerCustomerId ?? null,
    billableType: row.billableType,
    billableId: row.billableId,
    email: row.email,
    name: row.name ?? null,
    metadata: parseJson<Metadata>(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function customerToRow(data: Partial<NewCustomer>): Record<string, unknown> {
  return {
    tenantId: data.tenantId,
    provider: data.provider,
    providerCustomerId: data.providerCustomerId,
    billableType: data.billableType,
    billableId: data.billableId,
    email: data.email,
    name: data.name,
    metadata: data.metadata === undefined ? undefined : toJsonString(data.metadata),
  };
}
