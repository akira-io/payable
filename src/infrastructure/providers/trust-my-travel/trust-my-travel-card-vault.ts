import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../../domain/contracts/clock.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  ConfirmPaymentMethodSetupInput,
  CreatePaymentMethodSetupInput,
  PaymentMethodSetupDTO,
} from '../../../domain/dtos/payment-method-setup.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { CurrencyManager } from '../../../domain/value-objects/currency';
import type { TrustMyTravelClient } from './trust-my-travel-client';
import type { TmtTransactionResponse } from './trust-my-travel-transactions';
import type {
  TrustMyTravelChannelResponse,
  TrustMyTravelEnvironment,
} from './trust-my-travel-types';
import type { TrustMyTravelVaultReferenceCodec } from './trust-my-travel-vault-reference';

const CARD_VAULT_URL = 'https://vault.tmtprotects.com/1.8.0/';
const MAXIMUM_TOKEN_LIFETIME_SECONDS = 15 * 60;
const TOKEN_CLOCK_SKEW_SECONDS = 60;

export class TrustMyTravelCardVault {
  constructor(
    private readonly client: TrustMyTravelClient,
    private readonly codec: TrustMyTravelVaultReferenceCodec,
    private readonly channelId: number,
    private readonly currency: string,
    private readonly environment: TrustMyTravelEnvironment,
    private readonly clock: Clock,
  ) {}

  async create(
    input: CreatePaymentMethodSetupInput,
    _context: OperationContext,
  ): Promise<PaymentMethodSetupDTO> {
    if (input.usage !== 'off_session' || !input.currency || !input.returnUrl) {
      throw vaultError('CardVaulter requires off-session usage, currency and return URL');
    }
    const currency = CurrencyManager.normalize(input.currency);
    if (currency !== CurrencyManager.normalize(this.currency)) {
      throw vaultError('CardVaulter currency does not match the configured channel');
    }
    const channel = await this.channel(this.channelId);
    this.assertChannel(channel, currency);
    const token = await this.client.cardVaultToken();
    this.assertToken(token);
    const sessionId = randomBytes(16).toString('hex');
    const createdAt = this.clock.now();
    const providerSetupId = this.codec.sealSetup({
      sessionId,
      customerId: input.providerCustomerId,
      sitePath: this.client.sitePath,
      channelId: channel.id,
      currency,
      accountType: channel.account_type,
      environment: this.environment,
      createdAt: createdAt.toISOString(),
    });
    const checkoutUrl = new URL(CARD_VAULT_URL);
    checkoutUrl.search = new URLSearchParams({
      auth: token,
      path: this.client.sitePath,
      channels: String(channel.id),
      session_id: sessionId,
      redirect: input.returnUrl,
      currency,
      env: this.environment,
    }).toString();
    return this.dto(
      providerSetupId,
      input.providerCustomerId,
      'requires_action',
      checkoutUrl.href,
      null,
      createdAt,
    );
  }

  retrieve(providerSetupId: string): Promise<PaymentMethodSetupDTO> {
    const setup = this.codec.openSetup(providerSetupId);
    if (setup.sitePath !== this.client.sitePath) throw returnError();
    return Promise.resolve(
      this.dto(providerSetupId, setup.customerId, 'unknown', null, null, new Date(setup.createdAt)),
    );
  }

  cancel(providerSetupId: string): Promise<PaymentMethodSetupDTO> {
    const setup = this.codec.openSetup(providerSetupId);
    if (setup.sitePath !== this.client.sitePath) throw returnError();
    return Promise.reject(
      new PayableError('Trust My Travel CardVaulter sessions cannot be canceled remotely', {
        code: 'PROVIDER_TMT_CARD_VAULT_CANCEL_UNSUPPORTED',
        context: { provider: 'trust-my-travel' },
      }),
    );
  }

  async confirm(input: ConfirmPaymentMethodSetupInput): Promise<PaymentMethodSetupDTO> {
    const setup = this.codec.openSetup(input.providerSetupId);
    if (setup.sitePath !== this.client.sitePath) throw returnError();
    const returned = new URLSearchParams(input.providerReturn.replace(/^\?/u, ''));
    const transactionId = positiveInteger(returned.get('transaction_id'));
    const returnedToken = returned.get('token');
    if (returned.get('session_id') !== setup.sessionId || transactionId === null) {
      throw returnError();
    }
    const transaction = await this.client.request<TmtTransactionResponse>(
      `/transactions/${transactionId}`,
      { method: 'GET' },
    );
    if (
      transaction.id !== transactionId ||
      transaction.status !== 'complete' ||
      transaction.transaction_types !== 'vault' ||
      transaction.total !== 0 ||
      transaction.channels !== setup.channelId ||
      CurrencyManager.normalize(transaction.currencies) !== setup.currency ||
      !sameVaultToken(returnedToken, transaction.token)
    ) {
      throw transactionError();
    }
    const providerPaymentMethodId = this.codec.sealPaymentMethod({
      transactionId,
      sitePath: setup.sitePath,
      channelId: setup.channelId,
      currency: setup.currency,
      accountType: setup.accountType,
      environment: setup.environment,
      createdAt: setup.createdAt,
    });
    return {
      ...this.dto(
        input.providerSetupId,
        setup.customerId,
        'succeeded',
        null,
        providerPaymentMethodId,
        new Date(setup.createdAt),
      ),
      paymentMethod: {
        type: 'card',
        brand: transaction.card_types ?? null,
        lastFour: lastFourDigits(transaction.last_four_digits),
        expiryMonth: null,
        expiryYear: null,
      },
    };
  }

  private async channel(id: number): Promise<TrustMyTravelChannelResponse> {
    return this.client.request<TrustMyTravelChannelResponse>(`/channels/${id}`, { method: 'GET' });
  }

  private assertChannel(channel: TrustMyTravelChannelResponse, currency: string): void {
    if (
      channel.id !== this.channelId ||
      CurrencyManager.normalize(channel.currencies) !== currency ||
      channel.account_mode !== this.environment
    ) {
      throw vaultError('CardVaulter channel scope is invalid');
    }
  }

  private assertToken(token: string): void {
    const payload = token.split('.')[1];
    try {
      const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as {
        iat?: unknown;
        exp?: unknown;
      };
      const now = Math.floor(this.clock.now().getTime() / 1000);
      if (
        typeof claims.iat !== 'number' ||
        typeof claims.exp !== 'number' ||
        claims.iat > now + TOKEN_CLOCK_SKEW_SECONDS ||
        claims.exp <= claims.iat ||
        claims.exp <= now ||
        claims.exp - claims.iat > MAXIMUM_TOKEN_LIFETIME_SECONDS
      ) {
        throw new Error('invalid claims');
      }
    } catch {
      throw new PayableError('Trust My Travel card vault token is invalid', {
        code: 'PROVIDER_TMT_CARD_VAULT_TOKEN_INVALID',
        context: { provider: 'trust-my-travel' },
      });
    }
  }

  private dto(
    providerSetupId: string,
    providerCustomerId: string,
    status: PaymentMethodSetupDTO['status'],
    checkoutUrl: string | null,
    providerPaymentMethodId: string | null,
    createdAt: Date,
  ): PaymentMethodSetupDTO {
    return {
      providerSetupId,
      providerCustomerId,
      status,
      usage: 'off_session',
      clientSecret: null,
      checkoutUrl,
      providerPaymentMethodId,
      createdAt,
    };
  }
}

function sameVaultToken(returned: string | null, authoritative: string | undefined): boolean {
  if (!returned || !authoritative) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(returned), digest(authoritative));
}

function lastFourDigits(value: string | undefined): string | null {
  return value && /^\d{4}$/u.test(value) ? value : null;
}

function positiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function vaultError(message: string): PayableError {
  return new PayableError(message, {
    code: 'PROVIDER_TMT_CARD_VAULT_INVALID',
    context: { provider: 'trust-my-travel' },
  });
}

function returnError(): PayableError {
  return new PayableError('Trust My Travel card vault return is invalid', {
    code: 'PROVIDER_TMT_CARD_VAULT_RETURN_INVALID',
    context: { provider: 'trust-my-travel' },
  });
}

function transactionError(): PayableError {
  return new PayableError('Trust My Travel card vault transaction is invalid', {
    code: 'PROVIDER_TMT_CARD_VAULT_TRANSACTION_INVALID',
    context: { provider: 'trust-my-travel' },
  });
}
