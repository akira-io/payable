import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  StreamableFile,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { InvoiceDTO } from '../../domain/dtos/invoice.dto';
import type { Customer } from '../../domain/entities/customer.entity';
import type { Payment } from '../../domain/entities/payment.entity';
import type { Refund } from '../../domain/entities/refund.entity';
import type { Subscription } from '../../domain/entities/subscription.entity';
import { PayableError } from '../../domain/errors/payable-error';
import type { Payable } from '../../payable';
import { safeContentDispositionFilename } from '../shared/payable-http';
import {
  billableLookupSchema,
  listInvoicesQuerySchema,
  listRefundsQuerySchema,
  listSubscriptionsQuerySchema,
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

@Controller()
@UseFilters(PayableExceptionFilter)
@UseGuards(PayableAuthGuard)
export class PayableReadController {
  constructor(
    @Inject(PAYABLE_INSTANCE) private readonly payable: Payable,
    @Inject(PAYABLE_OPTIONS) private readonly options: NestPayableOptions,
  ) {}

  @Get('customers')
  async getCustomer(
    @Req() request: PayableHttpRequest,
    @Query() query: unknown,
  ): Promise<Customer> {
    const lookup = parseBody(billableLookupSchema, query);
    const customer = await this.payable.customers(undefined, this.tenantOf(request)).get(lookup);
    if (!customer) {
      throw new PayableError(`Customer not found: ${lookup.billableId}`, {
        code: 'CUSTOMER_NOT_FOUND',
      });
    }
    return customer;
  }

  @Get('invoices')
  invoices(@Req() request: PayableHttpRequest, @Query() query: unknown): Promise<InvoiceDTO[]> {
    const lookup = parseBody(listInvoicesQuerySchema, query);
    return this.payable
      .customer(
        { billableType: lookup.billableType, billableId: lookup.billableId },
        undefined,
        this.tenantOf(request),
      )
      .invoices(lookup.limit);
  }

  @Get('invoices/:id/pdf')
  async getInvoicePdf(
    @Req() request: PayableHttpRequest,
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<StreamableFile> {
    const billable = parseBody(billableLookupSchema, query);
    const pdf = await this.payable
      .invoices(undefined, this.tenantOf(request))
      .downloadPdf(id, billable);
    return new StreamableFile(Buffer.from(pdf.content), {
      type: 'application/pdf',
      disposition: `attachment; filename="${safeContentDispositionFilename(pdf.filename)}"`,
    });
  }

  @Get('payments')
  payments(@Req() request: PayableHttpRequest, @Query() query: unknown): Promise<Payment[]> {
    const lookup = parseBody(billableLookupSchema, query);
    return this.payable.customer(lookup, undefined, this.tenantOf(request)).payments();
  }

  @Get('subscriptions')
  subscriptions(
    @Req() request: PayableHttpRequest,
    @Query() query: unknown,
  ): Promise<Subscription[]> {
    const lookup = parseBody(listSubscriptionsQuerySchema, query);
    return this.payable
      .customer(
        { billableType: lookup.billableType, billableId: lookup.billableId },
        undefined,
        this.tenantOf(request),
      )
      .subscriptions(lookup.limit ? { limit: lookup.limit } : undefined);
  }

  @Get('subscriptions/:name')
  async getSubscription(
    @Req() request: PayableHttpRequest,
    @Param('name') name: string,
    @Query() query: unknown,
  ): Promise<Subscription> {
    const lookup = parseBody(billableLookupSchema, query);
    const subscription = await this.payable
      .customer(lookup, undefined, this.tenantOf(request))
      .subscription(name)
      .get();
    if (!subscription) {
      throw new PayableError(`Subscription not found: ${name}`, {
        code: 'SUBSCRIPTION_NOT_FOUND',
      });
    }
    return subscription;
  }

  @Get('refunds')
  listRefunds(@Req() request: PayableHttpRequest, @Query() query: unknown): Promise<Refund[]> {
    const lookup = parseBody(listRefundsQuerySchema, query);
    return this.payable
      .refunds(undefined, this.tenantOf(request))
      .list(lookup.paymentId, lookup.limit ? { limit: lookup.limit } : undefined);
  }

  private tenantOf(request: PayableHttpRequest): string | null {
    return resolveTenantId(this.options, request);
  }
}
