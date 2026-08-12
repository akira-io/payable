import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync('scripts/smoke-package-consumer.mjs', 'utf8');
const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');

describe('packed package consumer gate', () => {
  it('covers ESM, CJS, declarations, subpaths, bins, and package contents', () => {
    expect(script).toContain("execFileSync('npm', ['pack'");
    expect(script).toContain("await import('@akira-io/payable')");
    expect(script).toContain("require('@akira-io/payable')");
    expect(script).toContain("'/express'");
    expect(script).toContain("'/fastify'");
    expect(script).toContain("'/nest'");
    expect(script).toContain("'/mcp'");
    expect(script).toContain("'/sisp'");
    expect(script).toContain("'/prisma'");
    expect(script).toContain("['--noEmit', '-p', 'tsconfig.json']");
    expect(script).toContain('payable-mcp');
    expect(script).toContain('payable-prisma');
    expect(workflow).toContain('node scripts/smoke-package-consumer.mjs');
  });

  it('blocks publishing on Knex and Prisma beta upgrade verification', () => {
    expect(workflow).toContain('Verify beta7 to beta8 upgrades');
    expect(workflow).toContain('tests/beta-upgrade-smoke.test.ts');
    expect(workflow).toContain('fetch-depth: 0');
  });
});
