import { readFileSync } from 'node:fs';

const PEERS = [
  'stripe',
  '@paddle/paddle-node-sdk',
  'knex',
  'bullmq',
  'express',
  'fastify',
  '@nestjs/common',
  'reflect-metadata',
];

const FILES = ['dist/index.js', 'dist/index.cjs'];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const leaks = [];
for (const file of FILES) {
  const code = readFileSync(file, 'utf8');
  for (const peer of PEERS) {
    const staticEsm = new RegExp(`from["']${escapeRegExp(peer)}["']`);
    const staticCjs = new RegExp(`require\\(["']${escapeRegExp(peer)}["']\\)`);
    if (staticEsm.test(code) || staticCjs.test(code)) {
      leaks.push(`${file}: ${peer}`);
    }
  }
}

if (leaks.length > 0) {
  console.error(`Optional peer statically bundled into the core entry:\n${leaks.join('\n')}`);
  process.exit(1);
}

console.log('core bundle clean: no optional peer is statically imported');
