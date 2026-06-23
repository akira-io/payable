import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseFilters,
} from '@nestjs/common';
import type { Billable } from '../../application/builders/billable';
import type { CheckoutSessionDTO } from '../../domain/dtos/checkout.dto';
import type { Refund } from '../../domain/entities/refund.entity';
import type { Subscription } from '../../domain/entities/subscription.entity';
import { PayableError } from '../../domain/errors/payable-error';
import { Money } from '../../domain/value-objects/money';
import type { Payable } from '../../payable';
import {
  flattenHeaders,
  type NestPayableOptions,
  PAYABLE_INSTANCE,
  PAYABLE_OPTIONS,
  type PayableHttpRequest,
} from './payable.constants';
import { PayableExceptionFilter } from './payable.exception-filter';

interface CheckoutRequestBody {
  billable: Billable;
  subscription: { name: string; price: string; trialDays?: number; coupon?: string };
  successUrl: string;
  cancelUrl: string;
}

interface RefundRequestBody {
  paymentId?: string;
  amount?: { amount: number; currency: string };
  reason?: string;
}

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
  checkout(@Body() body: CheckoutRequestBody): Promise<CheckoutSessionDTO> {
    const builder = this.payable
      .customer(body.billable)
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
  cancel(@Param('name') name: string, @Body() body: { billable: Billable }): Promise<Subscription> {
    return this.manage('cancel', name, body.billable);
  }

  @Post('subscriptions/:name/cancel-now')
  @HttpCode(200)
  cancelNow(
    @Param('name') name: string,
    @Body() body: { billable: Billable },
  ): Promise<Subscription> {
    return this.manage('cancelNow', name, body.billable);
  }

  @Post('subscriptions/:name/resume')
  @HttpCode(200)
  resume(@Param('name') name: string, @Body() body: { billable: Billable }): Promise<Subscription> {
    return this.manage('resume', name, body.billable);
  }

  @Post('subscriptions/:name/swap')
  @HttpCode(200)
  swap(
    @Param('name') name: string,
    @Body() body: { billable: Billable; price: string },
  ): Promise<Subscription> {
    return this.payable.customer(body.billable).subscription(name).swap(body.price);
  }

  @Post('customers')
  customers(): never {
    throw PayableError.notImplemented('POST /customers');
  }

  @Get('invoices')
  invoices(): never {
    throw PayableError.notImplemented('GET /invoices');
  }

  @Get('payments')
  payments(): never {
    throw PayableError.notImplemented('GET /payments');
  }

  @Post('refunds')
  @HttpCode(201)
  refunds(@Body() body: RefundRequestBody): Promise<Refund> {
    if (typeof body?.paymentId !== 'string' || body.paymentId.length === 0) {
      throw new PayableError('paymentId is required', { code: 'VALIDATION_FAILED' });
    }
    const amount = body.amount ? Money.of(body.amount.amount, body.amount.currency) : undefined;
    return this.payable.refund({ paymentId: body.paymentId, amount, reason: body.reason });
  }

  private receive(request: PayableHttpRequest, provider: string | undefined) {
    const header = this.options.webhookSignatureHeader ?? 'stripe-signature';
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
    if (typeof request.body === 'string') {
      return request.body;
    }
    return '';
  }

  private manage(action: ManageAction, name: string, billable: Billable): Promise<Subscription> {
    return this.payable.customer(billable).subscription(name)[action]();
  }
}
