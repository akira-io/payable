import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

const problems = [];

for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
  for (const condition of ['types', 'import', 'require']) {
    const rel = entry[condition];
    if (!rel) {
      problems.push(`${subpath}: missing "${condition}" condition`);
      continue;
    }
    if (!existsSync(fileURLToPath(new URL(rel, root)))) {
      problems.push(`${subpath}: ${condition} -> ${rel} does not exist`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Broken exports map:\n${problems.join('\n')}`);
  process.exit(1);
}

const core = pkg.exports['.'];
const esm = await import(new URL(core.import, root).href);
if (typeof esm.createPayable !== 'function') {
  console.error('ESM core entry does not export createPayable');
  process.exit(1);
}
if (typeof esm.AuditResource !== 'function' || typeof esm.KnexAuditLogRepository !== 'function') {
  console.error('ESM core entry does not export the generic audit resource and Knex repository');
  process.exit(1);
}
if (
  typeof esm.SubscriptionPriceMigrationError !== 'function' ||
  !Array.isArray(esm.SUBSCRIPTION_PRICE_MIGRATION_STATUSES) ||
  esm.SubscriptionPriceMigrationResource !== undefined
) {
  console.error('ESM core entry does not expose the canonical migration contract safely');
  process.exit(1);
}

const cjs = require(fileURLToPath(new URL(core.require, root)));
if (typeof cjs.createPayable !== 'function') {
  console.error('CJS core entry does not export createPayable');
  process.exit(1);
}
if (typeof cjs.AuditResource !== 'function' || typeof cjs.KnexAuditLogRepository !== 'function') {
  console.error('CJS core entry does not export the generic audit resource and Knex repository');
  process.exit(1);
}
if (
  typeof cjs.SubscriptionPriceMigrationError !== 'function' ||
  !Array.isArray(cjs.SUBSCRIPTION_PRICE_MIGRATION_STATUSES) ||
  cjs.SubscriptionPriceMigrationResource !== undefined
) {
  console.error('CJS core entry does not expose the canonical migration contract safely');
  process.exit(1);
}

const prisma = pkg.exports['./prisma'];
const prismaEsm = await import(new URL(prisma.import, root).href);
const prismaCjs = require(fileURLToPath(new URL(prisma.require, root)));
if (
  typeof prismaEsm.PrismaAuditLogRepository !== 'function' ||
  typeof prismaCjs.PrismaAuditLogRepository !== 'function'
) {
  console.error('Prisma entry does not export PrismaAuditLogRepository under ESM and CJS');
  process.exit(1);
}

console.log(
  'exports verified: subpaths exist; core imports under ESM/CJS; migration implementation is internal',
);
