import { describe, expect, it } from 'vitest';
import { withStripeErrors } from '../src/infrastructure/providers/stripe/stripe-errors';

describe('stripe error detection', () => {
  it('rethrows a non-stripe error that merely has a type field', async () => {
    const foreign = { type: 'something_else', message: 'not stripe' };
    await expect(
      withStripeErrors(async () => {
        throw foreign;
      }),
    ).rejects.toBe(foreign);
  });

  it('wraps a stripe-shaped error in a PayableError', async () => {
    await expect(
      withStripeErrors(async () => {
        throw { type: 'StripeCardError', code: 'card_declined', message: 'declined' };
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_CARD_DECLINED' });
  });

  it('uses an operation-specific code resolver before the generic type mapping', async () => {
    await expect(
      withStripeErrors(
        async () => {
          throw {
            type: 'StripeInvalidRequestError',
            code: 'amount_too_large',
            message: 'invalid amount',
          };
        },
        'stripe-connect',
        undefined,
        (error) =>
          error.code === 'amount_too_large'
            ? 'MARKETPLACE_TRANSFER_REVERSAL_AMOUNT_EXCEEDED'
            : undefined,
      ),
    ).rejects.toMatchObject({
      code: 'MARKETPLACE_TRANSFER_REVERSAL_AMOUNT_EXCEEDED',
      context: {
        provider: 'stripe-connect',
        stripeType: 'StripeInvalidRequestError',
        stripeCode: 'amount_too_large',
      },
    });
  });

  it('falls back to the generic Stripe type mapping when a resolver returns undefined', async () => {
    await expect(
      withStripeErrors(
        async () => {
          throw { type: 'StripeInvalidRequestError', code: 'other', message: 'invalid' };
        },
        'stripe-connect',
        undefined,
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_INVALID' });
  });
});
