import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { IdempotencyResultPersistenceError } from '../src/domain/errors/idempotency-result-persistence.error';
import { PayableError } from '../src/domain/errors/payable-error';
import { errorResult } from '../src/presentation/mcp/context';
import {
  payableErrorBody,
  payableErrorStatus,
  safeContentDispositionFilename,
} from '../src/presentation/shared/payable-http';
import { parseBody, swapSubscriptionBodySchema } from '../src/presentation/shared/schemas';

describe('payableErrorStatus', () => {
  it('maps known domain error codes to their HTTP status', () => {
    const cases: Array<[string, number]> = [
      ['PAYMENT_NOT_FOUND', 404],
      ['WEBHOOK_EVENT_NOT_FOUND', 404],
      ['WEBHOOK_REPLAY_DENIED', 403],
      ['SUBSCRIPTION_PRICE_REQUIRED', 422],
      ['PROVIDER_CAPABILITY_NOT_SUPPORTED', 422],
      ['WEBHOOK_PROVIDER_AMBIGUOUS', 400],
      ['TENANT_REQUIRED', 400],
      ['COLLECTION_CURSOR_INVALID', 400],
      ['COLLECTION_LIMIT_INVALID', 422],
    ];
    for (const [code, status] of cases) {
      expect(payableErrorStatus(new PayableError('x', { code }))).toBe(status);
    }
  });

  it('falls back to 500 for unknown codes and non-Payable errors', () => {
    expect(payableErrorStatus(new PayableError('x', { code: 'SOMETHING_ELSE' }))).toBe(500);
    expect(payableErrorStatus(new Error('boom'))).toBe(500);
  });
});

describe('parseBody', () => {
  const schema = z.object({ name: z.string().min(1), age: z.number().int() });

  it('returns parsed data on success', () => {
    expect(parseBody(schema, { name: 'a', age: 1 })).toEqual({ name: 'a', age: 1 });
  });

  it('throws a VALIDATION_FAILED error with a minimal field/message issue shape', () => {
    try {
      parseBody(schema, { name: '', age: 'x' });
      throw new Error('expected parseBody to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PayableError);
      const context = (error as PayableError).context as {
        issues: Array<{ field: string; message: string }>;
      };
      expect((error as PayableError).code).toBe('VALIDATION_FAILED');
      for (const issue of context.issues) {
        expect(Object.keys(issue).sort()).toEqual(['field', 'message']);
      }
      expect(context.issues.map((issue) => issue.field)).toContain('age');
    }
  });

  it('preserves an explicit local item id for subscription swaps', () => {
    expect(
      parseBody(swapSubscriptionBodySchema, {
        billable: { billableType: 'User', billableId: '1', email: 'user@example.com' },
        itemId: 'local_item_1',
        price: 'price_new',
        effectiveTiming: 'immediate',
        prorationPolicy: 'prorateImmediately',
        paymentFailurePolicy: 'preventChange',
      }),
    ).toMatchObject({ itemId: 'local_item_1', price: 'price_new' });
  });
});

describe('payableErrorBody', () => {
  it('returns correlation and reconciliation guidance for an unpersisted result', () => {
    const error = new IdempotencyResultPersistenceError('catalog-request', {
      correlationId: 'corr-catalog-1',
      context: { response: { providerProductId: 'prod_secret' } },
    });

    expect(payableErrorBody(error)).toEqual({
      error: 'IDEMPOTENCY_RESULT_PERSISTENCE_FAILED',
      message: 'Failed to persist idempotency result for key: catalog-request',
      correlationId: 'corr-catalog-1',
      guidance:
        'Reconcile the provider result and durable local state before retrying with a new idempotency key.',
    });
  });

  it('surfaces validation fields for a VALIDATION_FAILED error', () => {
    const error = new PayableError('Request validation failed', {
      code: 'VALIDATION_FAILED',
      context: { issues: [{ field: 'age', message: 'Required' }] },
    });
    expect(payableErrorBody(error)).toEqual({
      error: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      fields: [{ field: 'age', message: 'Required' }],
    });
  });

  it('does not leak a non-Payable error message', () => {
    expect(payableErrorBody(new Error('internal secret detail'))).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'Unexpected error',
    });
  });
});

describe('safeContentDispositionFilename', () => {
  it('passes through a safe provider id filename', () => {
    expect(safeContentDispositionFilename('in_ABC-123.pdf')).toBe('in_ABC-123.pdf');
  });

  it('neutralizes quotes and CRLF used for header injection', () => {
    expect(safeContentDispositionFilename('a".pdf\r\nSet-Cookie: x=1')).toBe(
      'a_.pdf__Set-Cookie__x_1',
    );
  });

  it('falls back when nothing safe remains', () => {
    expect(safeContentDispositionFilename('"\r\n')).toBe('invoice.pdf');
  });
});

describe('mcp errorResult', () => {
  it('returns the safe idempotency persistence envelope', () => {
    const error = new IdempotencyResultPersistenceError('catalog-request', {
      correlationId: 'corr-catalog-1',
      context: { response: { providerProductId: 'prod_secret' } },
    });
    const block = errorResult(error).content[0];

    expect(block?.type === 'text' ? JSON.parse(block.text) : null).toEqual({
      error: 'IDEMPOTENCY_RESULT_PERSISTENCE_FAILED',
      message: 'Failed to persist idempotency result for key: catalog-request',
      correlationId: 'corr-catalog-1',
      guidance:
        'Reconcile the provider result and durable local state before retrying with a new idempotency key.',
    });
  });

  it('returns the code and message for a PayableError', () => {
    const block = errorResult(new PayableError('nope', { code: 'X' })).content[0];
    expect(block?.type === 'text' ? JSON.parse(block.text) : null).toEqual({
      error: 'X',
      message: 'nope',
    });
  });

  it('normalizes a non-PayableError without leaking its message', () => {
    const block = errorResult(new Error('provider internal detail')).content[0];
    expect(block?.type === 'text' ? JSON.parse(block.text) : null).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'Unexpected error',
    });
  });
});
