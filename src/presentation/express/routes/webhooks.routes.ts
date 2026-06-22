import { type Router, raw } from 'express';
import type { Payable } from '../../../payable';
import { asyncHandler, type ExpressPayableOptions, flattenHeaders } from '../helpers';

export function registerWebhookRoutes(
  router: Router,
  payable: Payable,
  options: ExpressPayableOptions,
): void {
  const header = options.webhookSignatureHeader ?? 'stripe-signature';
  const handler = asyncHandler(async (req, res) => {
    const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const provider = typeof req.params.provider === 'string' ? req.params.provider : undefined;
    const result = await payable.receiveWebhook({
      provider,
      payload,
      signature: req.header(header) ?? '',
      headers: flattenHeaders(req.headers),
    });
    res.status(200).json(result);
  });

  router.post('/webhooks', raw({ type: '*/*' }), handler);
  router.post('/webhooks/:provider', raw({ type: '*/*' }), handler);
}
