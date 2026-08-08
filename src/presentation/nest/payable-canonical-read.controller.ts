import { Controller, Get, Inject, Param, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { PayableError } from '../../domain/errors/payable-error';
import type { Payable } from '../../payable';
import {
  canonicalCustomerListQuerySchema,
  canonicalPaymentListQuerySchema,
  canonicalPriceListQuerySchema,
  canonicalProductListQuerySchema,
  canonicalSubscriptionListQuerySchema,
  catalogIdParamSchema,
  parseBody,
} from '../shared/schemas';
import {
  type NestPayableOptions,
  PAYABLE_INSTANCE,
  PAYABLE_OPTIONS,
  type PayableHttpRequest,
  resolveTenantId,
} from './payable.constants';
import { PayableExceptionFilter } from './payable.exception-filter';
import { PayableAuthGuard } from './payable-auth.guard';

@Controller('canonical')
@UseFilters(PayableExceptionFilter)
@UseGuards(PayableAuthGuard)
export class PayableCanonicalReadController {
  constructor(
    @Inject(PAYABLE_INSTANCE) private readonly payable: Payable,
    @Inject(PAYABLE_OPTIONS) private readonly options: NestPayableOptions,
  ) {}

  @Get('customers')
  listCustomers(@Req() request: PayableHttpRequest, @Query() query: unknown) {
    const input = parseBody(canonicalCustomerListQuerySchema, query);
    return this.payable.customers(undefined, this.tenantOf(request)).list(input);
  }

  @Get('customers/:id')
  async getCustomer(@Req() request: PayableHttpRequest, @Param('id') rawId: string) {
    const { id } = parseBody(catalogIdParamSchema, { id: rawId });
    const customer = await this.payable.customers(undefined, this.tenantOf(request)).find(id);
    if (!customer) {
      throw new PayableError(`Customer not found: ${id}`, {
        code: 'CUSTOMER_NOT_FOUND',
        context: { customerId: id },
      });
    }
    return customer;
  }

  @Get('products')
  listProducts(@Req() request: PayableHttpRequest, @Query() query: unknown) {
    const input = parseBody(canonicalProductListQuerySchema, query);
    return this.payable.products(this.tenantOf(request)).list(input);
  }

  @Get('products/:id')
  getProduct(@Req() request: PayableHttpRequest, @Param('id') rawId: string) {
    const { id } = parseBody(catalogIdParamSchema, { id: rawId });
    return this.payable.products(this.tenantOf(request)).retrieve(id);
  }

  @Get('prices')
  listPrices(@Req() request: PayableHttpRequest, @Query() query: unknown) {
    const input = parseBody(canonicalPriceListQuerySchema, query);
    return this.payable.prices(this.tenantOf(request)).list(input);
  }

  @Get('prices/:id')
  getPrice(@Req() request: PayableHttpRequest, @Param('id') rawId: string) {
    const { id } = parseBody(catalogIdParamSchema, { id: rawId });
    return this.payable.prices(this.tenantOf(request)).retrieve(id);
  }

  @Get('subscriptions')
  listSubscriptions(@Req() request: PayableHttpRequest, @Query() query: unknown) {
    const input = parseBody(canonicalSubscriptionListQuerySchema, query);
    return this.payable.canonicalSubscriptions(this.tenantOf(request)).list(input);
  }

  @Get('subscriptions/:id')
  getSubscription(@Req() request: PayableHttpRequest, @Param('id') rawId: string) {
    const { id } = parseBody(catalogIdParamSchema, { id: rawId });
    return this.payable.canonicalSubscriptions(this.tenantOf(request)).retrieve(id);
  }

  @Get('payments')
  listPayments(@Req() request: PayableHttpRequest, @Query() query: unknown) {
    const input = parseBody(canonicalPaymentListQuerySchema, query);
    return this.payable.storedPayments(this.tenantOf(request)).list(input);
  }

  @Get('payments/:id')
  getPayment(@Req() request: PayableHttpRequest, @Param('id') rawId: string) {
    const { id } = parseBody(catalogIdParamSchema, { id: rawId });
    return this.payable.storedPayments(this.tenantOf(request)).retrieve(id);
  }

  private tenantOf(request: PayableHttpRequest): string | null {
    return resolveTenantId(this.options, request);
  }
}
