<p align="center">
  <img src="assets/banner.svg" alt="@akira-io/payable" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@akira-io/payable"><img src="https://img.shields.io/npm/v/@akira-io/payable.svg" alt="npm"></a>
  <a href="https://www.npmjs.com/package/@akira-io/payable"><img src="https://img.shields.io/npm/dm/@akira-io/payable.svg" alt="downloads"></a>
  <a href="https://www.npmjs.com/package/@akira-io/payable"><img src="https://img.shields.io/bundlephobia/minzip/@akira-io/payable" alt="size"></a>
  <a href="https://github.com/akira-io/payable/actions/workflows/test.yml"><img src="https://github.com/akira-io/payable/actions/workflows/test.yml/badge.svg" alt="tests"></a>
  <img src="https://img.shields.io/npm/l/@akira-io/payable.svg" alt="license">
  <img src="https://img.shields.io/node/v/@akira-io/payable" alt="node">
</p>

Payable is a Laravel Cashier-inspired billing engine for Node.js: framework-agnostic, provider-agnostic,
storage-agnostic, and queue-agnostic. The core knows only contracts, DTOs, actions, value objects, and
state machines — never a provider SDK, HTTP framework, or database client. Money is always handled in
minor units through a `Money` value object backed by Dinero.js, so monetary logic never touches floats.

> Status: Phase 1 (Core Foundation) is implemented and tested. Stripe/Paddle providers, Knex storage,
> BullMQ queue, webhooks, idempotency, audit, outbox, and the Express/Fastify/NestJS adapters ship in
> later phases. Their files are scaffolded and throw a clear `NOT_IMPLEMENTED` error until then.

## Install

```sh
# npm
npm install @akira-io/payable

# pnpm
pnpm add @akira-io/payable

# bun
bun add @akira-io/payable
```

```json
{
  "dependencies": {
    "@akira-io/payable": "^0.1"
  }
}
```

## Quick start

```ts
import { createPayable, Money, StripeProvider } from '@akira-io/payable';

const payable = createPayable({
  providers: {
    stripe: new StripeProvider({
      secretKey: process.env.STRIPE_SECRET_KEY ?? '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    }),
  },
});

// Money is always in minor units — never floats, never toFixed.
const price = Money.of(9900, 'USD'); // $99.00
console.log(price.format()); // "$99.00"


await payable
  .customer({ billableType: 'User', billableId: user.id, email: user.email })
  .newSubscription('default')
  .price('price_pro_monthly')
  .trialDays(14)
  .checkout({ successUrl: 'https://app.com/success', cancelUrl: 'https://app.com/cancel' });
```

## Documentation

The architecture is the source of truth and the package mirrors it one phase at a time:

- `src/domain` — contracts, entities, DTOs, value objects, events, state machines, errors.
- `src/application` — actions, queries, builders, pipelines, policies, services.
- `src/infrastructure` — providers, storage, queue, cache, locks, encryption, event bus, audit, outbox.
- `src/presentation` — Express, Fastify, and NestJS adapters.
- `src/support` — config, logger, result, clock.

The public surface is exported from the package root; the fluent entry point is `createPayable(...)`.

## Testing

```sh
bun run test
```

## Changelog

Please see [CHANGELOG.md](CHANGELOG.md) for what has changed recently. The changelog is generated
from conventional commits via [git-cliff](https://git-cliff.org) on every release tag.

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Security Vulnerabilities

Please review [our security policy](SECURITY.md) on how to report security vulnerabilities.

## Credits

- [Kidiatoliny](https://github.com/kidiatoliny)
- [All Contributors](https://github.com/akira-io/payable/graphs/contributors)

## License

Dual-licensed under either of the following, at your option:

- MIT License ([LICENSE-MIT](LICENSE-MIT) or https://opensource.org/licenses/MIT)
- Apache License 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or https://www.apache.org/licenses/LICENSE-2.0)

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in
this project by you, as defined in the Apache-2.0 license, shall be dual-licensed as above, without
any additional terms or conditions.
