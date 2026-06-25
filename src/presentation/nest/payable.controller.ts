import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Billable } from '../../application/builders/billable';
import type { CheckoutSessionDTO } from '../../domain/dtos/checkout.dto';
import type { InvoiceDTO } from '../../domain/dtos/invoice.dto';
import type { PriceDTO } from '../../domain/dtos/price.dto';
import type { ProductDTO } from '../../domain/dtos/product.dto';
import type { Customer } from '../../domain/entities/customer.entity';
import type { Payment } from '../../domain/entities/payment.entity';
import type { Refund } from '../../domain/entities/refund.entity';
import type { Subscription } from '../../domain/entities/subscription.entity';
import { PayableError } from '../../domain/errors/payable-error';
import type { Payable } from '../../payable';
import {
  billableLookupSchema,
  checkoutBodySchema,
  customerBodySchema,
  customerUpdateBodySchema,
  listInvoicesQuerySchema,
  listRefundsQuerySchema,
  listSubscriptionsQuerySchema,
  manageSubscriptionBodySchema,
  parseBody,
  parseMoneyInput,
  priceBodySchema,
  productBodySchema,
  productUpdateBodySchema,
  refundBodySchema,
  swapSubscriptionBodySchema,
} from '../shared/schemas';
import {
  flattenHeaders,
  type NestPayableOptions,
  PAYABLE_INSTANCE,
  PAYABLE_OPTIONS,
  type PayableHttpRequest,
} from './payable.constants';
import { PayableExceptionFilter } from './payable.exception-filter';
import { PayableAuthGuard } from './payable-auth.guard';

type ManageAction = 'cancel' | 'cancelNow' | 'resume';

@Controller()
@UseFilters(PayableExceptionFilter)
export class PayableController {
  constructor(
    @Inject(PAYABLE_INSTANCE) private readonly payable: Payable,
    @Inject(PAYABLE_OPTIONS) private readonly options: NestPayableOptions,
  ) {}

  @Post('webhooks')
  @HttpCode(200)
  webhook(@Req() request: PayableHttpRequest) {
    return this.receive(request, undefined);
  }

  @Post('webhooks/:provider')
  @HttpCode(200)
  webhookForProvider(@Req() request: PayableHttpRequest, @Param('provider') provider: string) {
    return this.receive(request, provider);
  }

  @Post('checkout')
  @HttpCode(201)
  @UseGuards(PayableAuthGuard)
  checkout(
    @Req() request: PayableHttpRequest,
    @Body() rawBody: unknown,
  ): Promise<CheckoutSessionDTO> {
    const body = parseBody(checkoutBodySchema, rawBody);
    const builder = this.payable
      .customer(body.billable, undefined, this.tenantOf(request))
      .newSubscription(body.subscription.name)
      .price(body.subscription.price);
    if (body.subscription.trialDays !== undefined) {
      builder.trialDays(body.subscription.trialDays);
    }
    if (body.subscription.coupon) {
      builder.coupon(body.subscription.coupon);
    }
    return builder.checkout({ successUrl: body.successUrl, cancelUrl: body.cancelUrl });
  }

  @Post('subscriptions/:name/cancel')
  @HttpCode(200)
  @UseGuards(PayableAuthGuard)
  cancel(
    @Req() request: PayableHttpRequest,
    @Param('name') name: string,
    @Body() rawBody: unknown,
  ): Promise<Subscription> {
    const body = parseBody(manageSubscriptionBodySchema, rawBody);
    return this.manage('cancel', name, body.billable, this.tenantOf(request));
  }

  @Post('subscriptions/:name/cancel-now')
  @HttpCode(200)
  @UseGuards(PayableAuthGuard)
  cancelNow(
    @Req() request: PayableHttpRequest,
    @Param('name') name: string,
    @Body() rawBody: unknown,
  ): Promise<Subscription> {
    const body = parseBody(manageSubscriptionBodySchema, rawBody);
    return this.manage('cancelNow', name, body.billable, this.tenantOf(request));
  }

  @Post('subscriptions/:name/resume')
  @HttpCode(200)
  @UseGuards(PayableAuthGuard)
  resume(
    @Req() request: PayableHttpRequest,
    @Param('name') name: string,
    @Body() rawBody: unknown,
  ): Promise<Subscription> {
    const body = parseBody(manageSubscriptionBodySchema, rawBody);
    return this.manage('resume', name, body.billable, this.tenantOf(request));
  }

  @Post('subscriptions/:name/swap')
  @HttpCode(200)
  @UseGuards(PayableAuthGuard)
  swap(
    @Req() request: PayableHttpRequest,
    @Param('name') name: string,
    @Body() rawBody: unknown,
  ): Promise<Subscription> {
    const body = parseBody(swapSubscriptionBodySchema, rawBody);
    return this.payable
      .customer(body.billable, undefined, this.tenantOf(request))
      .subscription(name)
      .swap(body.price);
  }

  @Post('customers')
  @HttpCode(201)
  @UseGuards(PayableAuthGuard)
  createCustomer(@Req() request: PayableHttpRequest, @Body() rawBody: unknown): Promise<Customer> {
    const body = parseBody(customerBodySchema, rawBody);
    return this.payable.customers(undefined, this.tenantOf(request)).create(body.billable);
  }

  @Patch('customers')
  @UseGuards(PayableAuthGuard)
  updateCustomer(@Req() request: PayableHttpRequest, @Body() rawBody: unknown): Promise<Customer> {
    const body = parseBody(customerUpdateBodySchema, rawBody);
    return this.payable
      .customers(undefined, this.tenantOf(request))
      .update(body.billable, { email: body.email, name: body.name });
  }

  @Get('customers')
  @UseGuards(PayableAuthGuard)
  async getCustomer(
    @Req() request: PayableHttpRequest,
    @Query() query: unknown,
  ): Promise<Customer> {
    const lookup = parseBody(billableLookupSchema, query);
    const customer = await this.payable
      .customers(undefined, this.tenantOf(request))
      .get({ ...lookup, email: '' });
    if (!customer) {
      throw new PayableError(`Customer not found: ${lookup.billableId}`, {
        code: 'CUSTOMER_NOT_FOUND',
      });
    }
    return customer;
  }

  @Get('invoices')
  @UseGuards(PayableAuthGuard)
  invoices(@Req() request: PayableHttpRequest, @Query() query: unknown): Promise<InvoiceDTO[]> {
    const lookup = parseBody(listInvoicesQuerySchema, query);
    return this.payable
      .customer(
        { billableType: lookup.billableType, billableId: lookup.billableId, email: '' },
        undefined,
        this.tenantOf(request),
      )
      .invoices(lookup.limit);
  }

  @Get('payments')
  @UseGuards(PayableAuthGuard)
  payments(@Req() request: PayableHttpRequest, @Query() query: unknown): Promise<Payment[]> {
    const lookup = parseBody(billableLookupSchema, query);
    return this.payable
      .customer({ ...lookup, email: '' }, undefined, this.tenantOf(request))
      .payments();
  }

  @Get('subscriptions')
  @UseGuards(PayableAuthGuard)
  subscriptions(
    @Req() request: PayableHttpRequest,
    @Query() query: unknown,
  ): Promise<Subscription[]> {
    const lookup = parseBody(listSubscriptionsQuerySchema, query);
    return this.payable
      .customer(
        { billableType: lookup.billableType, billableId: lookup.billableId, email: '' },
        undefined,
        this.tenantOf(request),
      )
      .subscriptions(lookup.limit ? { limit: lookup.limit } : undefined);
  }

  @Get('subscriptions/:name')
  @UseGuards(PayableAuthGuard)
  async getSubscription(
    @Req() request: PayableHttpRequest,
    @Param('name') name: string,
    @Query() query: unknown,
  ): Promise<Subscription> {
    const lookup = parseBody(billableLookupSchema, query);
    const subscription = await this.payable
      .customer({ ...lookup, email: '' }, undefined, this.tenantOf(request))
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
  @UseGuards(PayableAuthGuard)
  listRefunds(@Req() request: PayableHttpRequest, @Query() query: unknown): Promise<Refund[]> {
    const lookup = parseBody(listRefundsQuerySchema, query);
    return this.payable
      .refunds(undefined, this.tenantOf(request))
      .list(lookup.paymentId, lookup.limit ? { limit: lookup.limit } : undefined);
  }

  @Post('refunds')
  @HttpCode(201)
  @UseGuards(PayableAuthGuard)
  refunds(@Req() request: PayableHttpRequest, @Body() rawBody: unknown): Promise<Refund> {
    const body = parseBody(refundBodySchema, rawBody);
    const amount = body.amount ? parseMoneyInput(body.amount) : undefined;
    return this.payable.refund(
      { paymentId: body.paymentId, amount, reason: body.reason },
      this.tenantOf(request),
    );
  }

  @Post('products')
  @HttpCode(201)
  @UseGuards(PayableAuthGuard)
  createProduct(@Req() request: PayableHttpRequest, @Body() rawBody: unknown): Promise<ProductDTO> {
    const body = parseBody(productBodySchema, rawBody);
    return this.payable.products(undefined, this.tenantOf(request)).create(body);
  }

  @Patch('products')
  @UseGuards(PayableAuthGuard)
  updateProduct(@Req() request: PayableHttpRequest, @Body() rawBody: unknown): Promise<ProductDTO> {
    const body = parseBody(productUpdateBodySchema, rawBody);
    return this.payable.products(undefined, this.tenantOf(request)).update(body);
  }

  @Post('prices')
  @HttpCode(201)
  @UseGuards(PayableAuthGuard)
  createPrice(@Req() request: PayableHttpRequest, @Body() rawBody: unknown): Promise<PriceDTO> {
    const body = parseBody(priceBodySchema, rawBody);
    return this.payable.prices(undefined, this.tenantOf(request)).create({
      providerProductId: body.providerProductId,
      unitAmount: parseMoneyInput(body.amount),
      interval: body.interval,
      intervalCount: body.intervalCount,
      description: body.description,
    });
  }

  private receive(request: PayableHttpRequest, provider: string | undefined) {
    const header = (this.options.webhookSignatureHeader ?? 'stripe-signature').toLowerCase();
    const signature = request.headers[header];
    return this.payable.receiveWebhook({
      provider,
      payload: this.extractPayload(request),
      signature: typeof signature === 'string' ? signature : '',
      headers: flattenHeaders(request.headers),
    });
  }

  private extractPayload(request: PayableHttpRequest): string {
    if (Buffer.isBuffer(request.rawBody)) {
      return request.rawBody.toString('utf8');
    }
    throw new PayableError(
      'Webhook body must be the raw request buffer; bootstrap Nest with { rawBody: true } and mount no body parser on the webhook route',
      { code: 'INVALID_WEBHOOK_PAYLOAD' },
    );
  }

  private manage(
    action: ManageAction,
    name: string,
    billable: Billable,
    tenantId: string | null,
  ): Promise<Subscription> {
    return this.payable.customer(billable, undefined, tenantId).subscription(name)[action]();
  }

  private tenantOf(request: PayableHttpRequest): string | null {
    return this.options.resolveTenant?.(request) ?? null;
  }
}
