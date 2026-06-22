# Changelog

All notable changes to this project are documented in this file. It is generated from conventional
commits via [git-cliff](https://git-cliff.org) on every release tag.

## [Unreleased]

### Added

- Phase 1 Core Foundation: `Money` value object (Dinero.js, minor units only) and `CurrencyManager`.
- Branded value objects: `ProviderName`, `IdempotencyKey`, `CorrelationId`, `TenantId`, and status types.
- Domain errors with `PayableError` base, state machines (subscription, invoice, payment, refund),
  domain events with normalized names, and an in-memory event bus.
- Full contract surface (payment provider, storage, queue, cache, lock, encryption, idempotency,
  repositories) and the `createPayable` factory with a fluent, Cashier-inspired facade.
- Architecture scaffold for later phases (providers, storage, queue, adapters) as typed placeholders.
