# Payable Documentation

`@akira-io/payable` is a Laravel Cashier-inspired billing engine for Node.js: framework-agnostic,
provider-agnostic, storage-agnostic, and queue-agnostic. This index lists the entire documentation
tree.

## Foundation

1. [01-overview.md](01-overview.md) - Purpose, the problem solved, target users, capabilities, and system boundaries.
2. [02-architecture.md](02-architecture.md) - The four layers plus support, the dependency rule, the zero-peer-dependency guarantee, and patterns in use.
3. [03-getting-started.md](03-getting-started.md) - Install, optional peers, Node requirement, and a first subscription checkout.
4. [04-configuration.md](04-configuration.md) - Every `PayableConfig` field, its default, and what it unlocks.

## Domain

5. [domain/05-domain-model.md](domain/05-domain-model.md) - Entities, DTOs, events, errors, and contracts.
6. [domain/06-value-objects.md](domain/06-value-objects.md) - `Money`, `Currency`, identifiers, and status value objects.
7. [domain/07-state-machines.md](domain/07-state-machines.md) - Subscription, payment, invoice, and refund state machines.

## Features

8. [features/08-customers-billable.md](features/08-customers-billable.md) - The `Billable` shape and `CustomerContext` entry point.
9. [features/09-checkout.md](features/09-checkout.md) - Payment and subscription checkout builders and the checkout pipeline.
10. [features/10-subscriptions.md](features/10-subscriptions.md) - Create, swap, cancel, resume, and update-quantity flows.
11. [features/11-charges-refunds.md](features/11-charges-refunds.md) - One-off charges and refunds.
12. [features/12-invoices-portal.md](features/12-invoices-portal.md) - Invoice listing/PDF and the billing portal.
13. [features/13-webhooks.md](features/13-webhooks.md) - Receipt, verification, normalization, dedup, async processing, and replay.
14. [features/14-idempotency.md](features/14-idempotency.md) - Idempotency strategies, the store, and the key resolver.
15. [features/15-reliability.md](features/15-reliability.md) - Audit log, transactional outbox, locks, and cache.
16. [features/16-multi-tenancy.md](features/16-multi-tenancy.md) - Tenant config, resolver, and scoping.

## Integrations

17. [integrations/17-providers.md](integrations/17-providers.md) - The `PaymentProvider` contract, optional capability interfaces, and capability detection.
18. [integrations/18-stripe.md](integrations/18-stripe.md) - The Stripe provider, webhook verifier, and normalizer.
19. [integrations/19-paddle.md](integrations/19-paddle.md) - The Paddle provider, webhook verifier, and normalizer.
20. [integrations/20-sisp.md](integrations/20-sisp.md) - The SISP (Cabo Verde / vinti4) provider: redirect checkout, callback reconciliation, and the optional `@akira-io/payable/sisp` subpath.

## Persistence

21. [persistence/20-storage-knex.md](persistence/20-storage-knex.md) - The Knex storage driver, repositories, and migrations.
22. [persistence/21-queue.md](persistence/21-queue.md) - The sync and BullMQ queue drivers.

## Adapters

23. [adapters/22-express.md](adapters/22-express.md) - Express routes adapter.
24. [adapters/23-fastify.md](adapters/23-fastify.md) - Fastify plugin adapter.
25. [adapters/24-nestjs.md](adapters/24-nestjs.md) - NestJS module adapter.
26. [adapters/25-mcp.md](adapters/25-mcp.md) - MCP server adapter for AI clients.

## Cross-cutting

27. [26-data-flows.md](26-data-flows.md) - End-to-end data flows for the main operations.
28. [27-security.md](27-security.md) - Signature verification, auth boundaries, encryption, and header redaction.
29. [28-development.md](28-development.md) - Build, lint, test, and the bundle check.
30. [29-operations.md](29-operations.md) - Running migrations, queue workers, and the outbox.
31. [30-troubleshooting.md](30-troubleshooting.md) - Common errors and their causes.
32. [31-faq.md](31-faq.md) - Frequently asked questions.

---

[Next: Overview](01-overview.md)
