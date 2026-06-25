import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PayableError } from '../src/domain/errors/payable-error';
import { payableErrorStatus } from '../src/presentation/shared/payable-http';
import { parseBody } from '../src/presentation/shared/schemas';

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
});
