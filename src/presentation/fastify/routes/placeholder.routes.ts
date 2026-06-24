import type { FastifyInstance } from 'fastify';
import { PayableError } from '../../../domain/errors/payable-error';
import type { Payable } from '../../../payable';

export async function registerPlaceholderRoutes(
  scope: FastifyInstance,
  _payable: Payable,
): Promise<void> {
  scope.get('/invoices', async () => {
    throw PayableError.notImplemented('GET /invoices');
  });
  scope.get('/payments', async () => {
    throw PayableError.notImplemented('GET /payments');
  });
}
