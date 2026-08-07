export interface PrismaCanonicalProductRow {
  id: string;
  tenantId: string | null;
  tenantKey: string;
  name: string;
  description: string | null;
  active: boolean;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaCanonicalPriceRow {
  id: string;
  tenantId: string | null;
  tenantKey: string;
  productId: string;
  currency: string;
  unitAmount: bigint;
  type: string;
  interval: string | null;
  intervalCount: number | null;
  description: string | null;
  lookupKey: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaProductProviderBindingRow {
  id: string;
  tenantId: string | null;
  tenantKey: string;
  productId: string;
  provider: string;
  providerProductId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaPriceProviderBindingRow {
  id: string;
  tenantId: string | null;
  tenantKey: string;
  priceId: string;
  provider: string;
  providerPriceId: string;
  createdAt: Date;
  updatedAt: Date;
}
