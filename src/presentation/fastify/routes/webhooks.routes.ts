import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Payable } from '../../../payable';
import { type FastifyPayableOptions, flattenHeaders } from '../helpers';

export async function registerWebhookRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions,
): Promise<void> {
  const header = options.webhookSignatureHeader ?? 'stripe-signature';
  scope.removeAllContentTypeParsers();
  scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  const handler = (request: FastifyRequest) => {
    const body = request.body;
    const payload = Buffer.isBuffer(body) ? body.toString('utf8') : '';
    const params = request.params as { provider?: string };
    const signature = request.headers[header];
    return payable.receiveWebhook({
      provider: typeof params.provider === 'string' ? params.provider : undefined,
      payload,
      signature: typeof signature === 'string' ? signature : '',
      headers: flattenHeaders(request.headers),
    });
  };

  scope.post('/webhooks', handler);
  scope.post('/webhooks/:provider', handler);
}
