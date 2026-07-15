import { type Router, raw } from 'express';
import { PayableError } from '../../../domain/errors/payable-error';
import type { Payable } from '../../../payable';
import { resolveWebhookSignatureHeader } from '../../shared/webhook-signature-header';
import { asyncHandler, type ExpressPayableOptions, flattenHeaders } from '../helpers';

const WEBHOOK_BODY_LIMIT = '1mb';

export function registerWebhookRoutes(
  router: Router,
  payable: Payable,
  options: ExpressPayableOptions,
): void {
  const handler = asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      throw new PayableError(
        'Webhook body must be the raw request buffer; mount the webhook router before any JSON body parser',
        { code: 'INVALID_WEBHOOK_PAYLOAD' },
      );
    }
    const provider = typeof req.params.provider === 'string' ? req.params.provider : undefined;
    const header = resolveWebhookSignatureHeader(
      provider,
      req.headers,
      options.webhookSignatureHeader,
    );
    const result = await payable.receiveWebhook({
      provider,
      payload: req.body.toString('utf8'),
      signature: req.header(header) ?? '',
      headers: flattenHeaders(req.headers),
    });
    res.status(200).json(result);
  });

  router.post('/webhooks', raw({ type: '*/*', limit: WEBHOOK_BODY_LIMIT }), handler);
  router.post('/webhooks/:provider', raw({ type: '*/*', limit: WEBHOOK_BODY_LIMIT }), handler);
}
