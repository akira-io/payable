# Operations

Building, releasing, publishing, and recovery for `@akira-io/payable`.

## Build

The build runs through tsup, emitting both ESM and CJS plus type declarations, targeting Node 20,
into `dist/`. There are nine build entries:

| Entry | Source |
| --- | --- |
| `index` | `src/index.ts` |
| `express/index` | `src/presentation/express/index.ts` |
| `fastify/index` | `src/presentation/fastify/index.ts` |
| `nest/index` | `src/presentation/nest/index.ts` |
| `mcp/index` | `src/presentation/mcp/index.ts` |
| `mcp/bin` | `src/presentation/mcp/bin.ts` |
| `sisp/index` | `src/presentation/sisp/index.ts` |
| `prisma/index` | `src/prisma/index.ts` |
| `prisma/bin` | `src/prisma/bin.ts` |

`mcp/bin` and `prisma/bin` are CLI entries (wired through the `bin` field to `./dist/mcp/bin.cjs` and
`./dist/prisma/bin.cjs`); they have no type-declaration entry and no `exports` subpath. The other
seven entries each back a public subpath.

`dinero.js`, a runtime dependency, is bundled into the output via `noExternal`; sourcemaps are
emitted and `dist/` is cleaned before each build. Run with `bun run build` (alias for `tsup`).

The `exports` map mirrors the seven subpath entries, so consumers import `@akira-io/payable`,
`@akira-io/payable/express`, `@akira-io/payable/fastify`, `@akira-io/payable/nest`,
`@akira-io/payable/mcp`, `@akira-io/payable/sisp`, or `@akira-io/payable/prisma`, each resolving to
the matching `types`/`import`/`require` target under `dist/`. Two bins are exposed: `payable-mcp` and
`payable-prisma`.

## Bundle guarantee check

Run `bun run verify:bundle` to assert that no optional peer is statically imported into
`dist/index.js` or `dist/index.cjs`. The peer set is read dynamically from `package.json`
`peerDependencies`, so the check stays in sync; at the time of writing it covers `stripe`,
`@paddle/paddle-node-sdk`, `knex`, `bullmq`, `express`, `fastify`, `@nestjs/common`, `@nestjs/core`,
`reflect-metadata`, `@modelcontextprotocol/sdk`, `@fastify/rate-limit`, `@prisma/client`, and
`@akira-io/sisp`. A leak fails the build. This keeps the core entry free of provider and framework
code; those land only in the subpath bundles or are loaded dynamically.

## Continuous integration

CI runs on pushes to `main` and on pull requests. Two jobs:

- `test` (Bun): install with `bun install --frozen-lockfile`, then `lint`, `typecheck`,
  `test:coverage`, `build`, `verify:bundle`, and `verify:exports`.
- `node` (matrix): Node 20 and Node 22, install with `bun install --frozen-lockfile`, then
  `npx tsc --noEmit`, `npx vitest run`, `bun run build`, and `node scripts/check-exports.mjs`. This
  confirms typecheck, tests, build, and dist imports pass on every supported Node version.

## Release

The release workflow runs on pushing a tag matching `v[0-9]+.[0-9]+.[0-9]+` or a prerelease
`v[0-9]+.[0-9]+.[0-9]+-*`. The job:

1. Checks out with full history (`fetch-depth: 0`) and installs git-cliff.
2. Bumps `package.json` `version` to the tag (stripping the leading `v`).
3. Regenerates `CHANGELOG.md` from `cliff.toml` for that tag.
4. Commits `package.json` and `CHANGELOG.md` back to the default branch.
5. Extracts release notes (`git-cliff --latest --strip all`) and creates the GitHub Release
   (`gh release create`).
6. Posts the release to Discord.

`cliff.toml` uses conventional commits: `feat` -> Features, `fix` -> Bug Fixes, `perf` ->
Performance Improvements, `refactor` -> Code Refactoring; `docs`, `style`, `test`, `ci`, and
`chore` are grouped but skipped from the changelog. The changelog is generated - never hand-edit
`CHANGELOG.md`.

## Publishing

- `prepublishOnly` runs `bun run build`, so `npm publish` always ships a fresh `dist/`.
- Only the built output is published; source and tests are excluded.
- The `exports` map defines the public surface (core plus the `express`, `fastify`, `nest`, `mcp`,
  `sisp`, and `prisma` subpaths). Anything not in `exports` is not importable by consumers.
- The package is dual-licensed `(MIT OR Apache-2.0)`, ships as an ES module, and is marked
  side-effect free.

## Maintenance and supported runtimes

- Supported Node: `>=20`, verified against Node 20 and 22 in CI.
- Migrations are additive. `migrate(knex)` runs `createBillingTables`, `createSystemTables`, then
  `alterExistingTables`. New columns and tables are added; existing structure is preserved.
- Optional peers are declared as optional, so installing the core does not pull Stripe, Paddle,
  Knex, BullMQ, or a framework.

## Recovery procedures

- Missing tables / fresh database: run `migrate(knex)` against the target connection before serving
  traffic. It is safe to re-run; it creates what is absent.
- Replay a processed or failed webhook: call `payable.replayWebhook(webhookEventId, context,
  provider?)`. The replay is gated by `CanReplayWebhookPolicy` and a tenant match (context must
  carry `allowed: true` and a non-empty `actorId`), then re-runs `ProcessWebhookPipeline` from the
  stored event.
- Redeliver outbox events: call `payable.outbox(options?).publishPending(deliver, limit)`. Failed
  deliveries are retried with exponential backoff up to `maxAttempts` (default 5), then
  dead-lettered. Re-running `publishPending` picks up pending and retry-eligible rows.
- Reprocess a queued webhook job (BullMQ): the job name is `webhook.process`
  (`PROCESS_WEBHOOK_JOB`). BullMQ applies its own attempts/backoff; persistently failing jobs are
  removed per `removeOnFailCount`.

---

[Previous: Development](29-development.md) | [Index](00-index.md) | [Next: Troubleshooting](31-troubleshooting.md)
