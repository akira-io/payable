import type { CatalogPage, ListPricesInput, ListProductsInput } from '../dtos/catalog.dto';
import type { OperationContext } from '../dtos/common.dto';
import type {
  CreatePriceInput,
  PriceDTO,
  TransferPriceLookupKeyInput,
  UpdatePriceInput,
} from '../dtos/price.dto';
import type { CreateProductInput, ProductDTO, UpdateProductInput } from '../dtos/product.dto';
import type { PaymentProvider } from './payment-provider.contract';

export interface CatalogCapable {
  createProduct(input: CreateProductInput, ctx: OperationContext): Promise<ProductDTO>;
  updateProduct(input: UpdateProductInput, ctx: OperationContext): Promise<ProductDTO>;
  createPrice(input: CreatePriceInput, ctx: OperationContext): Promise<PriceDTO>;
}

export interface CatalogProductCreateCapable {
  createProduct(input: CreateProductInput, ctx: OperationContext): Promise<ProductDTO>;
}

export interface CatalogProductUpdateCapable {
  updateProduct(input: UpdateProductInput, ctx: OperationContext): Promise<ProductDTO>;
}

export interface CatalogPriceCreateCapable {
  createPrice(input: CreatePriceInput, ctx: OperationContext): Promise<PriceDTO>;
}

export interface CatalogPriceUpdateCapable {
  updatePrice(input: UpdatePriceInput, ctx: OperationContext): Promise<PriceDTO>;
}

export interface CatalogReadCapable {
  retrieveProduct(id: string): Promise<ProductDTO>;
  listProducts(input?: ListProductsInput): Promise<CatalogPage<ProductDTO>>;
  retrievePrice(id: string): Promise<PriceDTO>;
  listPrices(input?: ListPricesInput): Promise<CatalogPage<PriceDTO>>;
}

export interface CatalogLifecycleCapable {
  setProductActive(id: string, active: boolean, ctx: OperationContext): Promise<ProductDTO>;
  setPriceActive(id: string, active: boolean, ctx: OperationContext): Promise<PriceDTO>;
}

export interface PriceLookupKeyCapable {
  createPrice(input: CreatePriceInput, ctx: OperationContext): Promise<PriceDTO>;
  listPrices(input?: ListPricesInput): Promise<CatalogPage<PriceDTO>>;
  transferPriceLookupKey(
    input: TransferPriceLookupKeyInput,
    ctx: OperationContext,
  ): Promise<PriceDTO>;
}

export function isCatalogCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & CatalogCapable {
  const candidate = provider as Partial<CatalogCapable>;
  return (
    typeof candidate.createProduct === 'function' &&
    typeof candidate.updateProduct === 'function' &&
    typeof candidate.createPrice === 'function'
  );
}

export function isCatalogProductCreateCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & CatalogProductCreateCapable {
  return typeof (provider as Partial<CatalogProductCreateCapable>).createProduct === 'function';
}

export function isCatalogProductUpdateCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & CatalogProductUpdateCapable {
  return typeof (provider as Partial<CatalogProductUpdateCapable>).updateProduct === 'function';
}

export function isCatalogPriceCreateCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & CatalogPriceCreateCapable {
  return typeof (provider as Partial<CatalogPriceCreateCapable>).createPrice === 'function';
}

export function isCatalogPriceUpdateCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & CatalogPriceUpdateCapable {
  return typeof (provider as Partial<CatalogPriceUpdateCapable>).updatePrice === 'function';
}

export function isCatalogReadCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & CatalogReadCapable {
  const candidate = provider as Partial<CatalogReadCapable>;
  return (
    typeof candidate.retrieveProduct === 'function' &&
    typeof candidate.listProducts === 'function' &&
    typeof candidate.retrievePrice === 'function' &&
    typeof candidate.listPrices === 'function'
  );
}

export function isCatalogLifecycleCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & CatalogLifecycleCapable {
  const candidate = provider as Partial<CatalogLifecycleCapable>;
  return (
    typeof candidate.setProductActive === 'function' &&
    typeof candidate.setPriceActive === 'function'
  );
}

export function isPriceLookupKeyCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & PriceLookupKeyCapable {
  const candidate = provider as Partial<PriceLookupKeyCapable>;
  return (
    typeof candidate.createPrice === 'function' &&
    typeof candidate.listPrices === 'function' &&
    typeof candidate.transferPriceLookupKey === 'function'
  );
}
