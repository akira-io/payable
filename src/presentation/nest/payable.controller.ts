import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Billable } from '../../application/builders/billable';
import type { AuthorizationContext } from '../../application/policies/authorization-context';
import type { CheckoutSessionDTO } from '../../domain/dtos/checkout.dto';
import type { PriceDTO } from '../../domain/dtos/price.dto';
import type { ProductDTO } from '../../domain/dtos/product.dto';
import type { Customer } from '../../domain/entities/customer.entity';
import type { Refund } from '../../domain/entities/refund.entity';
import type { Subscription } from '../../domain/entities/subscription.entity';
import { PayableError } from '../../domain/errors/payable-error';
import type { Payable } from '../../payable';
import {
  runCheckout,
  runManageSubscription,
  runRefund,
  runSwapSubscription,
} from '../shared/operations';
import {
  checkoutBodySchema,
  customerBodySchema,
  customerUpdateBodySchema,
  manageSubscriptionBodySchema,
  parseBody,
  parseMoneyInput,
  priceBodySchema,
  productBodySchema,
  productUpdateBodySchema,
  refundBodySchema,
  swapSubscriptionBodySchema,
} from '../shared/schemas';
import { resolveWebhookSignatureHeader } from '../shared/webhook-signature-header';
import {
  flattenHeaders,
  type NestPayableOptions,
  PAYABLE_INSTANCE,
  PAYABLE_OPTIONS,
  type PayableHttpRequest,
  resolveAuthorization,
  resolveTenantId,
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
    return runCheckout(this.payable, body, this.tenantOf(request), this.authorizationOf(request));
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
    return this.manage(
      'cancel',
      name,
      body.billable,
      this.tenantOf(request),
      this.authorizationOf(request),
    );
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
    return this.manage(
      'cancelNow',
      name,
      body.billable,
      this.tenantOf(request),
      this.authorizationOf(request),
    );
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
    return this.manage(
      'resume',
      name,
      body.billable,
      this.tenantOf(request),
      this.authorizationOf(request),
    );
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
    return runSwapSubscription(
      this.payable,
      name,
      body,
      this.tenantOf(request),
      this.authorizationOf(request),
    );
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

  @Post('refunds')
  @HttpCode(201)
  @UseGuards(PayableAuthGuard)
  refunds(@Req() request: PayableHttpRequest, @Body() rawBody: unknown): Promise<Refund> {
    const body = parseBody(refundBodySchema, rawBody);
    return runRefund(this.payable, body, this.tenantOf(request), this.authorizationOf(request));
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
    const header = resolveWebhookSignatureHeader(
      provider,
      request.headers,
      this.options.webhookSignatureHeader,
    );
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
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    return runManageSubscription(this.payable, action, name, billable, tenantId, authorization);
  }

  private authorizationOf(request: PayableHttpRequest): AuthorizationContext | undefined {
    return resolveAuthorization(this.options, request);
  }

  private tenantOf(request: PayableHttpRequest): string | null {
    return resolveTenantId(this.options, request);
  }
}
