import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PayableError } from '../../../domain/errors/payable-error';
import type { Payable } from '../../../payable';
import { type FastifyPayableOptions, flattenHeaders } from '../helpers';
import { WEBHOOK_BODY_LIMIT } from '../limits';

export async function registerWebhookRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions,
): Promise<void> {
  const header = options.webhookSignatureHeader ?? 'stripe-signature';
  scope.removeAllContentTypeParsers();
  scope.addContentTypeParser(
    '*',
    { parseAs: 'buffer', bodyLimit: WEBHOOK_BODY_LIMIT },
    (_request, body, done) => {
      done(null, body);
    },
  );

  const handler = (request: FastifyRequest) => {
    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      throw new PayableError(
        'Webhook body must be the raw request buffer; do not register a JSON body parser on the webhook scope',
        { code: 'INVALID_WEBHOOK_PAYLOAD' },
      );
    }
    const params = request.params as { provider?: string };
    const signature = request.headers[header];
    return payable.receiveWebhook({
      provider: typeof params.provider === 'string' ? params.provider : undefined,
      payload: body.toString('utf8'),
      signature: typeof signature === 'string' ? signature : '',
      headers: flattenHeaders(request.headers),
    });
  };

  const routeOptions = { bodyLimit: WEBHOOK_BODY_LIMIT };
  scope.post('/webhooks', routeOptions, handler);
  scope.post('/webhooks/:provider', routeOptions, handler);
}
