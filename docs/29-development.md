# Development

How to work on `@akira-io/payable`: structure, workflow, standards, and the test/lint/build loop.

## Project structure recap

The codebase follows clean-architecture layers under `src/`:

- `domain/` - entities, value objects, DTOs, events, errors, contracts. No outward dependencies.
- `application/` - actions, builders, pipelines, policies. Depends only on `domain`.
- `infrastructure/` - providers (Stripe, Paddle, SISP), storage (Knex), queue (sync, BullMQ), event
  bus, encryption, cache, locks, outbox, audit.
- `presentation/` - the Express, Fastify, NestJS, and MCP adapters, the SISP redirect helpers, and
  shared HTTP helpers.
- `support/` - config resolution, clock, correlation, header redaction.

`src/payable.ts` is the facade adapters call; `src/create-payable.ts` resolves config into a
`Payable`. See `docs/02-architecture.md` for the dependency rule and patterns.

## Dev workflow

- One phase per PR. The architecture document is the source of truth; do not introduce structure
  outside it, and do not advance to the next phase until tests, types, and lint pass.
- Branch from `main`; open PRs against `main`.
- Add tests for every change.
- Use conventional commit messages - the changelog is generated from them via git-cliff.
- Keep diffs focused: refactors, feature work, and dependency bumps belong in separate PRs. No
  drive-by refactors in feature PRs.

## Coding standards

- Biome and `tsc` outputs are the source of truth for style and types.
- Self-documenting code; no narrative comments.
- No emojis in code, copy, commit messages, or PR descriptions.
- Match existing sibling-file conventions.

## Testing strategy

Tests live in `tests/` and run on Vitest, which includes `tests/**/*.test.ts`.

- Real container and database, no mocks. The Knex tests run against an in-memory `better-sqlite3`
  database created by `createTestDb()` with `filename: ':memory:'`.
- External services are represented by fakes, not mocks: `FakeProvider` and the fakes in
  `tests/support/`. Time is controlled with `FakeClock`.
- Adapter tests drive the real adapters: `tests/express.test.ts` uses Supertest against an Express
  app, `tests/fastify.test.ts` uses `app.inject`, `tests/nest.test.ts` instantiates the controller
  and exception filter directly.
- Coverage thresholds are enforced at 78% for statements, branches, functions, and lines.

### Optional test suites

Some suites exercise optional peer dependencies that a minimal install does not have, so they are
excluded unless their dependencies are present. `vitest.config.ts` builds the exclude list from
`optionalSuiteExcludes(isInstalled)` (`vitest.suites.ts`), where `isInstalled` resolves a module via
`require.resolve`:

```ts
export function optionalSuiteExcludes(isInstalled: (name: string) => boolean): string[] {
  const exclude: string[] = [];
  if (!isInstalled(MCP_PROBE)) {
    exclude.push(...MCP_SUITES);
  }
  if (!NEST_PROBES.every(isInstalled)) {
    exclude.push(...NEST_SUITES);
  }
  return exclude;
}
```

- The MCP suites (`mcp-tools`, `mcp-http`, `mcp-policy`) are excluded unless
  `@modelcontextprotocol/sdk/client/index.js` resolves.
- The NestJS suite (`nest`) is excluded unless `@nestjs/common`, `@nestjs/core`, and
  `reflect-metadata` all resolve.

Because these probes match the optional peers, `vitest run` passes in a minimal install (the core
zero-required-peer install) instead of failing on missing modules. Installing the optional peers turns
the matching suites back on automatically.

## How to run

The package scripts are run with Bun in CI; locally either Bun or npm works.

| Task | Command |
| --- | --- |
| Run all tests | `bun run test` (`vitest run`) |
| Tests with coverage | `bun run test:coverage` |
| A single test by name | `npx vitest run -t "name"` |
| Typecheck | `bun run typecheck` (`tsc --noEmit`) |
| Lint | `bun run lint` (`biome check .`) |
| Lint and autofix | `bun run lint:fix` (`biome check --write .`) |
| Build | `bun run build` (`tsup`) |
| Verify core bundle | `bun run verify:bundle` |

Vitest's `-t`/`--testNamePattern` selects by test name; `vitest run path/to/file.test.ts` selects by
file.

## Bundle verification

`bun run verify:bundle` runs `scripts/check-core-bundle.mjs`, which scans `dist/index.js` and
`dist/index.cjs` for static imports of every optional peer declared in `peerDependencies` (read
dynamically from `package.json`, so the list stays in sync). If any peer is statically imported into
the core entry, the script exits non-zero. This guards the zero-required-peer guarantee: the core
entry must not pull a provider or framework into every consumer's bundle.

## Debugging approaches

- Reproduce HTTP behavior with the adapter tests; they exercise routing, raw-body handling, and
  error mapping end to end.
- For storage behavior, build an in-memory Knex DB with `createTestDb()` and run `migrate(db)`
  (`src/infrastructure/storage/knex/migrations/migrate.ts`) before exercising repositories.
- For webhook flows, set `FakeProvider.verifyResult` (or `verifyError`) to control the verified
  event and assert on `storage.webhookEvents.findByProviderEvent(...)`.
- Use `payable.events().listen('*', ...)` to observe every emitted domain event during a test.
- `PayableError` carries a machine-readable `code`, optional `context`, and `correlationId`; assert
  on `code` rather than HTTP status when testing actions directly.

---

[Previous: Security](28-security.md) | [Index](00-index.md) | [Next: Operations](30-operations.md)
